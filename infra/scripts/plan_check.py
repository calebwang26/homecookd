#!/usr/bin/env python3
"""Decides whether a saved plan of infra/envs/staging may apply with nobody watching. It refuses anything it doesn't understand.

    plan_check.py files infra/envs/staging infra/modules     # before Terraform runs: what a plan alone could run or read
    plan_check.py plan plan.json --backend terraform.tfstate  # `terraform show -json`, and init's record of the backend

Exit 0 lets it through. Anything else, a crash included, stops the workflow and goes to Caleb. Reasons name resources and fields,
never values, because they go out by email. The rules:

  1. Deletes or replaces an RDS instance or an S3 bucket.
  2. Touches anything outside staging.
  3. Changes IAM trust or permissions.
  4. Turns on real models, opens something new to the public, or sets a secret's value.
  5. Adds an estimated $50 a month or more.
  0. Anything else it can't place: an unknown type, a field it can't see yet, a Terraform feature it wasn't taught.

The shape of it: AUTO lists the few types that may change by themselves. Every other type staging has today is in DOORS, which
may exist but never change here. Anything in neither is refused. The role (infra/staging-apply-role) can write only AUTO's
types, so most of these rules hold even if a merge rewrites this file. Teaching it a new type is a reviewed change to AUTO, and
Caleb applying the role if it needs a new permission.
"""
import argparse
import json
import re
import sys
from collections import namedtuple
from pathlib import Path

TERRAFORM_VERSION = "1.17.1"  # the workflow pins the same one; test_plan_check.py compares them
PROVIDER = "registry.terraform.io/hashicorp/aws"
REGION = "us-west-2"
MONTHLY_LIMIT = 50.0
HOURS = 730

# List prices in us-west-2. Only fixed monthly charges count: what a bucket, queue, log group or CloudFront costs depends on use, and a
# plan can't show that. DOORS never apply here, so they need no price, and a type in neither table is refused, unpriced.
FARGATE_VCPU_HOUR = 0.04048
FARGATE_GB_HOUR = 0.004445
FARGATE_DISK_GB_HOUR = 0.000111  # ephemeral storage past the free 20 GiB (modules/env's disk_gib)
FARGATE_FREE_DISK_GB = 20

Auto = namedtuple("Auto", "actions scope known monthly forbidden", defaults=((),))
AUTO = {
    "aws_ecs_task_definition": Auto(("create", "replace", "delete"), "family", ("family", "container_definitions", "cpu", "memory", "task_role_arn", "execution_role_arn"), 0),
    "aws_ecs_service": Auto(("update",), "cluster", ("cluster", "desired_count"), 0),  # priced below, from its task definition
    "aws_cloudwatch_metric_alarm": Auto(("create", "update", "delete"), "alarm_name", ("alarm_name", "alarm_actions", "ok_actions", "insufficient_data_actions"), 0.30),
    "aws_cloudwatch_log_group": Auto(("create", "update"), "name", ("name",), 0),
    "aws_sqs_queue": Auto(("create", "update"), "name", ("name",), 0, ("policy",)),
    "aws_scheduler_schedule": Auto(("create", "update", "delete"), "name", ("name", "schedule_expression", "target"), 0),
    "aws_secretsmanager_secret": Auto(("create",), "name", ("name",), 0.40, ("policy", "replica", "kms_key_id")),
    "aws_s3_bucket_cors_configuration": Auto(("create", "update", "delete"), "bucket", ("bucket", "cors_rule"), 0),
    "aws_s3_bucket_lifecycle_configuration": Auto(("create", "update"), "bucket", ("bucket", "rule"), 0),
    "aws_cloudfront_function": Auto(("update",), "name", ("name", "code"), 0),
}

IAM = "IAM goes through Caleb: the role holds no IAM write"
PUBLIC = "can open staging to the public or change its network paths"
HELD = "this type doesn't change without Caleb"
DOORS = {
    **dict.fromkeys(("aws_iam_role", "aws_iam_role_policy", "aws_iam_role_policy_attachment"), (3, IAM)),
    **dict.fromkeys(
        (
            "aws_s3_bucket_policy", "aws_s3_bucket_public_access_block", "aws_vpc_security_group_ingress_rule",
            "aws_vpc_security_group_egress_rule", "aws_security_group", "aws_cloudfront_distribution", "aws_cloudfront_cache_policy",
            "aws_cloudfront_origin_access_control", "aws_cloudfront_response_headers_policy", "aws_lb", "aws_lb_listener",
            "aws_lb_listener_rule", "aws_lb_target_group", "aws_route_table", "aws_route_table_association", "aws_subnet", "aws_vpc",
            "aws_vpc_endpoint", "aws_internet_gateway", "aws_nat_gateway", "aws_eip",
        ),
        (4, PUBLIC),
    ),
    **dict.fromkeys(
        (
            "aws_db_instance", "aws_db_subnet_group", "aws_s3_bucket", "aws_s3_bucket_versioning", "aws_ecr_repository",
            "aws_ecr_lifecycle_policy", "aws_ecs_cluster", "aws_sns_topic", "aws_sns_topic_subscription",
            # A log line counted into a metric. The role can't write one (no logs:PutMetricFilter), so a change is Caleb's.
            "aws_cloudwatch_log_metric_filter",
            # How many tasks the autoscaler may run, and when. A target's max is spend the count alone doesn't show, the account's
            # first target makes an IAM role, and the role can't write either.
            "aws_appautoscaling_target", "aws_appautoscaling_policy",
        ),
        (0, HELD),
    ),
}
KEEP_FOREVER = {"aws_db_instance", "aws_s3_bucket"}
SECRET_VALUE_TYPES = {"aws_secretsmanager_secret_version", "aws_secretsmanager_secret_rotation", "aws_ssm_parameter"}
SECRET_VALUE_FIELDS = ("password", "password_wo", "secret_string", "secret_string_wo", "secret_binary")
RUNS_COMMANDS = {"null_resource", "terraform_data"}

# Data sources run during the plan. These only look things up; aws_lambda_invocation, for one, would call a function.
DATA_SOURCES = {
    "aws_availability_zones", "aws_caller_identity", "aws_region", "aws_iam_policy_document", "aws_cloudfront_cache_policy",
    "aws_cloudfront_origin_request_policy",
}
MODULE_SOURCES = {"env": "../../modules/env", "web": "../../modules/web", "front_door": "../../modules/front_door"}
# How each module is told it's staging. front_door takes a name, so its name must be staging's.
MODULE_ENVIRONMENT = {"env": ("environment", "staging"), "web": ("environment", "staging"), "front_door": ("name", "homecookd-staging-")}
BACKEND_ALLOWED = {"bucket", "key", "region", "use_lockfile"}
PLAN_KEYS = {
    "format_version", "terraform_version", "variables", "planned_values", "resource_drift", "resource_changes", "output_changes",
    "prior_state", "configuration", "relevant_attributes", "checks", "timestamp", "applyable", "complete", "errored",
}
MODULE_KEYS = {"resources", "module_calls", "outputs", "variables"}

# Which models and voices each service may run with. Fake flags on, and no secret beyond these.
FAKE_FLAGS = {
    "api": {"DISH_FAKE_AI": "1"},
    "voice": {"VOICE_STUB": "1", "VOICE_FAKE_SPEECH": "1"},
    "worker": {},
}
# None of these spends money or reaches a model: the real model keys stay out, and only a real_ai window, by hand, names them. EDIBLE_CODE_KEY
# seals links (api/src/sealed.ts), TEST_SIGNIN_KEY is the scripts' sign-in, LINK_JOIN_SECRET and LEFT_IDENTITY_SECRET are staging's own (make-salt.sh).
ALLOWED_SECRETS = {
    "SENTRY_DSN_API", "SENTRY_DSN_WORKER", "RATE_LIMIT_SALT", "DB_CREDENTIALS",
    "EDIBLE_CODE_KEY", "TEST_SIGNIN_KEY", "LINK_JOIN_SECRET", "LEFT_IDENTITY_SECRET",
}
NO_KEY = "staging-no-key"
KEY_NAME = re.compile(r"KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|DSN")
KEY_VALUE = re.compile(r"sk-ant-|sk_car|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|-----BEGIN|ghp_|gho_|github_pat_")
CONTAINER_KEYS = {
    "name", "image", "essential", "stopTimeout", "portMappings", "environment", "secrets", "logConfiguration", "mountPoints",
    "systemControls", "volumesFrom", "cpu",
}
# The one entry point a task may set: the worker in queue mode (infra/envs/staging/main.tf). Any other runs what it likes in a staging image.
ENTRY_POINTS = {"worker": ["python", "pipeline/queue_worker.py"]}
LIVE_NAMES = re.compile(
    r"homecookd[-/](production|backups|tfstate)|grand-dragon-649|bsudybxsqvtwftsdmwmz|edible-|homecookd\.app|DEPLOY_ENV\W+production",
    re.I,
)
STAGING_NAME = re.compile(r"(^|[/:\s])homecookd[-/]staging([-/:]|$)")
ARN = re.compile(r'arn:aws[a-z-]*:[^"\\\s,\]}\']+')
RESOURCE_ID = re.compile(r"\b(?:sgr?|vpc|subnet|rtb|igw|nat|eipalloc|vpce|eni|pl)-[0-9a-f]{8,17}\b")

# Terraform features that act during a plan or an apply without showing up in the plan's JSON. Found by planning a test config:
# ephemeral and check blocks leave no trace there at all.
BLOCKS = re.compile(r'^\s*(?:moved\s*\{|removed\s*\{|import\s*\{|ephemeral\s+"|action\s+"|check\s+"|provisioner\s+"|connection\s*\{)', re.M)


Reason = namedtuple("Reason", "guard rule text")
PLAN_GUARDS = []
FILE_GUARDS = []


def guard(rule, into=PLAN_GUARDS):
    def add(fn):
        into.append((fn.__name__, rule, fn))
        return fn

    return add


def action_of(resource):
    return {
        ("no-op",): "no-op",
        ("create",): "create",
        ("update",): "update",
        ("delete",): "delete",
        ("delete", "create"): "replace",
        ("create", "delete"): "replace",
        ("read",): "read",
    }.get(tuple(resource["change"]["actions"]), "other")


def unknown(tree):
    if isinstance(tree, dict):
        return any(unknown(v) for v in tree.values())
    if isinstance(tree, list):
        return any(unknown(v) for v in tree)
    return tree is True


def after(resource):
    return resource["change"].get("after") or {}


def before(resource):
    return resource["change"].get("before") or {}


class Plan:
    def __init__(self, raw, backend):
        self.raw = raw
        self.backend = (backend or {}).get("backend") or {}
        self.resources = raw.get("resource_changes") or []
        self.changes = [r for r in self.resources if action_of(r) != "no-op"]
        self.managed_changes = [r for r in self.changes if r.get("mode") == "managed"]
        self.written = [r for r in self.managed_changes if r["change"].get("after") is not None]
        # What staging's own state already holds counts as staging's: an ARN or id seen here isn't reaching outside.
        self.known = "\n".join(json.dumps(before(r)) for r in self.resources)
        bucket = re.fullmatch(r"homecookd-tfstate-(\d{12})", str((self.backend.get("config") or {}).get("bucket")))
        self.account = bucket.group(1) if bucket else None
        self.config = {}
        root = (raw.get("configuration") or {}).get("root_module") or {}
        for name, call in (root.get("module_calls") or {}).items():
            for block in (call.get("module") or {}).get("resources") or []:
                self.config[(f"module.{name}", block.get("address"))] = block
        for block in root.get("resources") or []:
            self.config[(None, block.get("address"))] = block

    def modules(self):
        root = (self.raw.get("configuration") or {}).get("root_module") or {}
        yield "root", root
        for name, call in (root.get("module_calls") or {}).items():
            yield name, call.get("module") or {}

    def settings(self, resource):
        key = (resource.get("module_address"), f"{resource['type']}.{resource['name']}")
        return (self.config.get(key) or {}).get("expressions") or {}

    def text(self, resource):
        """Everything this change would write, as searchable text. The website's own code isn't a setting."""
        values = {k: v for k, v in after(resource).items() if not (resource["type"] == "aws_cloudfront_function" and k == "code")}
        return json.dumps(values)


# Files, before Terraform runs. With the workflow's provider setting, the only code a plan can then run is the AWS provider.


@guard(0, FILE_GUARDS)
def forbidden_files(dirs):
    for root in dirs:
        for path in sorted(Path(root).rglob("*")):
            name = path.name
            if name.endswith((".tf.json", ".tfvars", ".tfvars.json")) or name == "override.tf" or name.endswith("_override.tf"):
                yield f"{path}: this kind of file changes settings where the plan's checks can't see where they came from"
            if path.is_dir() and name in ("terraform.d", ".terraform"):
                yield f"{path}: Terraform could load a provider from here"


@guard(0, FILE_GUARDS)
def forbidden_blocks(dirs):
    for root in dirs:
        for path in sorted(Path(root).rglob("*.tf")):
            if BLOCKS.search(path.read_text()):
                yield f"{path}: has a moved, removed, import, ephemeral, action, check or provisioner block"


@guard(2, FILE_GUARDS)
def lock_file_providers(dirs):
    lock = Path(dirs[0]) / ".terraform.lock.hcl"
    if not lock.exists():
        yield f"{lock}: missing"
        return
    found = set(re.findall(r'^provider "([^"]+)"', lock.read_text(), re.M))
    if found != {PROVIDER}:
        yield f"{lock}: names a provider other than hashicorp/aws"


# The plan: is it a shape this script was written for?


@guard(0)
def plan_shape(plan):
    raw = plan.raw
    extra = sorted(set(raw) - PLAN_KEYS)
    if extra:
        yield "plan", f"has parts this check doesn't know: {', '.join(extra)}"
    if not str(raw.get("format_version", "")).startswith("1."):
        yield "plan", "unknown plan format"
    if raw.get("terraform_version") != TERRAFORM_VERSION:
        yield "plan", "made by a Terraform version other than the pinned one"
    if raw.get("errored") is not False:
        yield "plan", "the plan had errors"
    if raw.get("complete") is not True:
        yield "plan", "the plan is incomplete: some changes were left for later"


@guard(0)
def checks_pass(plan):
    for item in plan.raw.get("checks") or []:
        if item.get("status") not in ("pass", "unknown"):
            yield "plan", "a check or precondition in the config isn't passing"


@guard(0)
def known_config_blocks(plan):
    for name, module in plan.modules():
        extra = sorted(set(module) - MODULE_KEYS)
        if extra:
            yield f"module {name}", f"has blocks this check doesn't know: {', '.join(extra)}"


@guard(2)
def module_sources(plan):
    root = dict(plan.modules())["root"]
    calls = root.get("module_calls") or {}
    if set(calls) != set(MODULE_SOURCES):
        yield "config", "its modules aren't exactly env, web and front_door"
    for name, call in calls.items():
        if call.get("source") != MODULE_SOURCES.get(name):
            yield f"module {name}", "comes from somewhere else"
        if (call.get("module") or {}).get("module_calls"):
            yield f"module {name}", "pulls in another module"


@guard(2)
def environment_name(plan):
    root = dict(plan.modules())["root"]
    for name, call in (root.get("module_calls") or {}).items():
        arg, want = MODULE_ENVIRONMENT.get(name, ("environment", "staging"))
        value = ((call.get("expressions") or {}).get(arg) or {}).get("constant_value")
        if not isinstance(value, str) or not (value == want if arg == "environment" else value.startswith(want)):
            yield f"module {name}", "its environment isn't the plain word staging"


@guard(2)
def backend_is_staging(plan):
    b = plan.backend
    config = b.get("config") or {}
    if b.get("type") != "s3":
        yield "backend", "isn't the S3 backend"
    if config.get("key") != "staging/terraform.tfstate" or config.get("region") != REGION or config.get("use_lockfile") is not True:
        yield "backend", "its key, region or locking changed"
    if plan.account is None:
        yield "backend", "isn't the state bucket"
    extra = sorted(k for k, v in config.items() if v not in (None, [], {}) and k not in BACKEND_ALLOWED)
    if extra:
        yield "backend", f"sets something new: {', '.join(extra)}"


@guard(2)
def provider_is_aws(plan):
    providers = (plan.raw.get("configuration") or {}).get("provider_config") or {}
    if set(providers) != {"aws"} or providers["aws"].get("full_name") != PROVIDER:
        yield "provider", "there's a provider other than one plain hashicorp/aws"
        return
    expressions = providers["aws"].get("expressions") or {}
    extra = sorted(set(expressions) - {"region", "default_tags"})
    if extra:
        yield "provider", f"sets something new, which could point it elsewhere: {', '.join(extra)}"
    if (expressions.get("region") or {}).get("constant_value") != REGION:
        yield "provider", "its region changed"
    tags = (expressions.get("default_tags") or [{}])[0].get("tags") or {}
    if (tags.get("constant_value") or {}).get("Environment") != "staging":
        yield "provider", "its default tags aren't staging's"


@guard(2)
def resource_providers(plan):
    for r in plan.resources:
        if r.get("provider_name") != PROVIDER:
            yield r["address"], "uses another provider"


@guard(0)
def no_provisioners(plan):
    for name, module in plan.modules():
        for block in module.get("resources") or []:
            if block.get("provisioners"):
                yield f"module {name}: {block.get('address')}", "runs a command with a provisioner"


@guard(0)
def only_known_data_sources(plan):
    for name, module in plan.modules():
        for block in module.get("resources") or []:
            if block.get("mode") == "data" and block.get("type") not in DATA_SOURCES:
                yield f"module {name}: {block.get('address')}", "reads through a data source this check doesn't know"
            if block.get("mode") not in ("data", "managed"):
                yield f"module {name}: {block.get('address')}", "is a kind of block this check doesn't know"


# Each change: what it is and how it got here.


@guard(0)
def known_actions(plan):
    for r in plan.changes:
        if action_of(r) == "other":
            yield r["address"], f"unknown action: {'/'.join(r['change']['actions'])}"
        if r.get("deposed"):
            yield r["address"], "is left over from a failed replace"


@guard(0)
def no_moved(plan):
    for r in plan.resources:
        if r.get("previous_address"):
            yield r["address"], "moved in the config: a moved block can hide what a change does"


@guard(0)
def no_imports(plan):
    for r in plan.resources:
        if r["change"].get("importing") or r["change"].get("generated_config"):
            yield r["address"], "imports something already in AWS, which may not be staging's"


@guard(0)
def no_deferred_reads(plan):
    for r in plan.changes:
        if r.get("mode") != "managed" and action_of(r) == "read":
            yield r["address"], "reads data only at apply, so the plan can't show what depends on it"
        elif r.get("mode") != "managed":
            yield r["address"], "isn't a managed resource"


@guard(0)
def known_types(plan):
    for r in plan.resources:
        if r.get("mode") == "managed" and r["type"] not in AUTO and r["type"] not in DOORS:
            yield r["address"], "this check doesn't know this type, so it can't place it or estimate its cost"


@guard(0)
def no_command_runners(plan):
    for r in plan.resources:
        if r["type"] in RUNS_COMMANDS:
            yield r["address"], "exists to run commands"


@guard(1)
def keeps_databases_and_buckets(plan):
    for r in plan.managed_changes:
        if r["type"] in KEEP_FOREVER and action_of(r) in ("delete", "replace", "other"):
            yield r["address"], f"would {action_of(r)} it"


def door_guard(name, rule):
    def check(plan):
        for r in plan.managed_changes:
            door = DOORS.get(r["type"])
            if door and door[0] == rule:
                yield r["address"], door[1]

    check.__name__ = name
    return guard(rule)(check)


door_guard("iam_is_never_automatic", 3)
door_guard("public_paths_are_never_automatic", 4)
door_guard("held_types_are_never_automatic", 0)


@guard(0)
def auto_actions(plan):
    for r in plan.managed_changes:
        rule = AUTO.get(r["type"])
        if rule and action_of(r) not in rule.actions:
            yield r["address"], f"this type may not {action_of(r)} by itself"


@guard(0)
def fields_that_matter_are_known(plan):
    for r in plan.written:
        rule = AUTO.get(r["type"])
        tree = r["change"].get("after_unknown") or {}
        for field in rule.known if rule else ():
            if unknown(tree.get(field)):
                yield r["address"], f"{field} isn't known until apply"


@guard(0)
def forbidden_settings(plan):
    for r in plan.written:
        rule = AUTO.get(r["type"])
        for field in rule.forbidden if rule else ():
            if field in plan.settings(r) or after(r).get(field):
                yield r["address"], f"sets {field}"


LIFECYCLE_LIMITS = (
    ("expiration", "days"),
    ("expiration", "date"),
    ("noncurrent_version_expiration", "noncurrent_days"),
    ("abort_incomplete_multipart_upload", "days_after_initiation"),
)


@guard(1)
def lifecycle_keeps_files(plan):
    """Lifecycle rules apply by themselves, but `expiration { days = 1 }` would empty a bucket. Only a longer wait, or no wait, passes. The web bucket is rebuilt from the repo."""
    for r in plan.written:
        if r["type"] != "aws_s3_bucket_lifecycle_configuration" or "-web-" in str(after(r).get("bucket", "")):
            continue
        old = {rule.get("id"): rule for rule in before(r).get("rule") or []}
        for rule in after(r).get("rule") or []:
            was = old.get(rule.get("id")) or {}
            for block, field in LIFECYCLE_LIMITS:
                for item in rule.get(block) or []:
                    value = item.get(field)
                    if not value:
                        continue
                    earlier = [x.get(field) for x in was.get(block) or [] if x.get(field)]
                    if not earlier or (field == "date") or value < min(earlier):
                        yield r["address"], f"a new or shorter {block} can delete staging's files"
            if was and was.get("filter") != rule.get("filter") and any(rule.get(block) for block, _ in LIFECYCLE_LIMITS):
                yield r["address"], "a changed filter can bring more files under a rule that deletes them"


# Rule 2: stays inside staging


@guard(2)
def named_for_staging(plan):
    for r in plan.managed_changes:
        rule = AUTO.get(r["type"])
        if not rule:
            continue
        value = (after(r) or before(r)).get(rule.scope)
        if rule.scope == "cluster" and isinstance(value, str):  # the one that's an ARN
            value = value.rsplit(":", 1)[-1].removeprefix("cluster/")
        if not isinstance(value, str) or not re.match(r"/?homecookd[-/]staging([-/]|$)", value):
            yield r["address"], f"its {rule.scope} isn't one of staging's names"


@guard(2)
def stays_in_region(plan):
    for r in plan.written:
        if after(r).get("region") not in (None, REGION):
            yield r["address"], "is in another region"


@guard(2)
def no_live_names(plan):
    for r in plan.written:
        if LIVE_NAMES.search(plan.text(r)):
            yield r["address"], "mentions production, the backups, the state bucket or a live backend"


@guard(2)
def arns_stay_in_staging(plan):
    for r in plan.written:
        for arn in set(ARN.findall(plan.text(r))):
            parts = arn.split(":", 5)
            if arn in plan.known:
                continue
            if len(parts) < 6 or parts[4] != plan.account or not STAGING_NAME.search(parts[5]):
                yield r["address"], "points at an ARN outside staging"
                break


@guard(2)
def resource_ids_are_staging(plan):
    for r in plan.written:
        for found in set(RESOURCE_ID.findall(plan.text(r))):
            if found not in plan.known:
                yield r["address"], "points at a network resource staging doesn't own"
                break


# Rule 4: real models, public access, secret values


@guard(4)
def real_ai_stays_off(plan):
    value = ((plan.raw.get("variables") or {}).get("real_ai") or {}).get("value")
    if value not in (False, "false"):  # -var and an env value arrive as text
        yield "variable real_ai", "real models are on"


def containers(resource):
    return json.loads(after(resource)["container_definitions"])


def task_definitions(plan):
    for r in plan.written:
        if r["type"] == "aws_ecs_task_definition" and isinstance(after(r).get("container_definitions"), str):
            service = str(after(r).get("family")).removeprefix("homecookd-staging-")
            yield r, service, containers(r)


@guard(4)
def fake_flags_stay_on(plan):
    for r, service, defs in task_definitions(plan):
        if service not in FAKE_FLAGS:
            yield r["address"], "isn't a service this check knows"
            continue
        for c in defs:
            env = {e.get("name"): e.get("value") for e in c.get("environment") or []}
            for name, value in FAKE_FLAGS[service].items():
                if env.get(name) != value:
                    yield r["address"], f"{name} is off, which turns on real models"
            if env.get("DEPLOY_ENV") != "staging":
                yield r["address"], "DEPLOY_ENV isn't staging"


@guard(4)
def task_secrets_are_listed(plan):
    for r, _, defs in task_definitions(plan):
        for c in defs:
            for s in c.get("secrets") or []:
                name = s.get("name")
                if name not in ALLOWED_SECRETS:
                    yield r["address"], f"names the secret {name}, which staging's fake setup doesn't use"
                elif name != "DB_CREDENTIALS" and f":secret:homecookd/staging/{name}-" not in str(s.get("valueFrom")):
                    yield r["address"], f"{name} reads from a different secret"
                elif name == "DB_CREDENTIALS" and not (":secret:rds!db-" in str(s.get("valueFrom")) and s.get("valueFrom") in plan.known):
                    yield r["address"], f"{name} isn't staging's database secret"


@guard(4)
def no_keys_in_plain_env(plan):
    for r, _, defs in task_definitions(plan):
        for c in defs:
            for e in c.get("environment") or []:
                if KEY_NAME.search(str(e.get("name"))) and e.get("value") != NO_KEY:
                    yield r["address"], f"sets {e.get('name')} in plain env"


@guard(4)
def no_key_shaped_values(plan):
    for r in plan.written:
        if KEY_VALUE.search(json.dumps(after(r))):
            yield r["address"], "has a value shaped like a real key"


@guard(4)
def task_runs_staging_image(plan):
    for r, service, defs in task_definitions(plan):
        extra = sorted({k for c in defs for k in c} - CONTAINER_KEYS - {"entryPoint"})
        if extra:
            yield r["address"], f"sets container fields this check doesn't know: {', '.join(extra)}"
        for c in defs:
            if "entryPoint" in c and c["entryPoint"] != ENTRY_POINTS.get(service):
                yield r["address"], "sets an entry point other than this service's own"
        for c in defs:
            image = rf"{plan.account}\.dkr\.ecr\.{REGION}\.amazonaws\.com/homecookd-staging/{re.escape(service)}:[\w.-]+"
            if not re.fullmatch(image, str(c.get("image"))):
                yield r["address"], "runs an image from outside staging's repository"
        for field, suffix in (("task_role_arn", "task"), ("execution_role_arn", "execution")):
            if not str(after(r).get(field)).endswith(f":role/homecookd-staging-{service}-{suffix}"):
                yield r["address"], f"{field} isn't this service's own role"


@guard(4)
def service_only_changes_count(plan):
    for r in plan.written:
        if r["type"] == "aws_ecs_service":
            changed = {k for k in set(before(r)) | set(after(r)) if before(r).get(k) != after(r).get(k)}
            extra = sorted(changed - {"desired_count", "tags", "tags_all"})
            if extra:
                yield r["address"], f"changes more than its count: {', '.join(extra)}"


@guard(4)
def cors_stays_closed(plan):
    for r in plan.written:
        if r["type"] != "aws_s3_bucket_cors_configuration":
            continue
        was = {o for rule in before(r).get("cors_rule") or [] for o in rule.get("allowed_origins") or []}
        for rule in after(r).get("cors_rule") or []:
            origins = set(rule.get("allowed_origins") or [])
            if "*" in origins - was:
                yield r["address"], "opens the bucket to every site"
            if "*" in origins and set(rule.get("allowed_methods") or []) - {"GET", "HEAD"}:
                yield r["address"], "lets every site write to the bucket"


@guard(4)
def no_secret_values(plan):
    for r in plan.resources:
        if r["type"] in SECRET_VALUE_TYPES:
            yield r["address"], "sets a secret's value"
    for r in plan.written:
        for field in SECRET_VALUE_FIELDS:
            if after(r).get(field) not in (None, "") or unknown((r["change"].get("after_unknown") or {}).get(field)) or field in plan.settings(r):
                yield r["address"], f"sets {field}"


# Rule 5: cost


def fargate_monthly(count, definition):
    disk = sum(int(e["size_in_gib"]) for e in definition.get("ephemeral_storage") or [])
    extra_disk = max(0, disk - FARGATE_FREE_DISK_GB) * FARGATE_DISK_GB_HOUR
    return count * HOURS * (int(definition["cpu"]) / 1024 * FARGATE_VCPU_HOUR + int(definition["memory"]) / 1024 * FARGATE_GB_HOUR + extra_disk)


def monthly_added(plan):
    """What this plan adds, resource by resource: savings don't offset additions. Raises when a service's cost can't be worked out.
    An autoscaled service is priced at its target's max, because a bigger task there can run that many times."""
    total = 0.0
    definitions = {
        (after(r) or before(r)).get("family"): r for r in plan.resources if r["type"] == "aws_ecs_task_definition"
    }
    targets = {
        str((after(r) or before(r)).get("resource_id")).rsplit("/", 1)[-1]: r for r in plan.resources if r["type"] == "aws_appautoscaling_target"
    }
    for r in plan.resources:
        if r["type"] == "aws_ecs_service":
            name = (after(r) or before(r)).get("name")
            definition = definitions[f"homecookd-staging-{name}"]
            count, sized = ("max_capacity", targets[name]) if name in targets else ("desired_count", r)
            was = fargate_monthly(before(sized)[count], before(definition)) if before(r) and before(sized).get(count) else 0
            now = fargate_monthly(after(sized)[count], after(definition)) if after(r) and after(sized).get(count) else 0
            total += max(0, now - was)
    for r in plan.managed_changes:
        rule = AUTO.get(r["type"])
        if rule and action_of(r) == "create":
            total += rule.monthly
    return total


@guard(5)
def cost_is_small(plan):
    try:
        added = monthly_added(plan)
    except (KeyError, TypeError, ValueError):
        yield "cost", "couldn't estimate what this plan adds"
        return
    if round(added, 2) >= MONTHLY_LIMIT:
        yield "cost", f"adds about ${added:.0f} a month, and the limit is ${MONTHLY_LIMIT:.0f}"


def check_plan(raw, backend, guards=None):
    plan = Plan(raw, backend)
    reasons = []
    for name, rule, fn in guards if guards is not None else PLAN_GUARDS:
        try:
            for where, text in fn(plan):
                reasons.append(Reason(name, rule, f"{where}: {text}"))
        except Exception as error:  # a plan this script can't read is a plan it refuses; the type alone, no values
            reasons.append(Reason(name, rule, f"couldn't read the plan ({type(error).__name__})"))
    return reasons


def check_files(dirs, guards=None):
    reasons = []
    for name, rule, fn in guards if guards is not None else FILE_GUARDS:
        try:
            reasons += [Reason(name, rule, text) for text in fn(dirs)]
        except Exception as error:
            reasons.append(Reason(name, rule, f"couldn't read the config ({type(error).__name__})"))
    return reasons


def report(reasons):
    print(f"REFUSED: {len(reasons)} reason(s). Nothing was applied.")
    for r in reasons:
        print(f"  rule {r.rule} [{r.guard}] {r.text}")
    return 1


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    files = sub.add_parser("files")
    files.add_argument("dirs", nargs="+")
    planned = sub.add_parser("plan")
    planned.add_argument("plan")
    planned.add_argument("--backend", required=True)
    args = parser.parse_args()
    if args.command == "files":
        reasons = check_files(args.dirs)
        if reasons:
            return report(reasons)
        print("Files are fine.")
        return 0
    raw = json.loads(Path(args.plan).read_text())
    reasons = check_plan(raw, json.loads(Path(args.backend).read_text()))
    if reasons:
        return report(reasons)
    plan = Plan(raw, None)
    print(f"ALLOWED: {len(plan.changes)} change(s), about ${monthly_added(plan):.2f} a month added in fixed charges.")
    for r in plan.changes:
        print(f"  {action_of(r)} {r['address']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
