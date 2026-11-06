#!/usr/bin/env python3
"""Asks AWS's policy simulator what the staging apply role's policy allows and refuses. Read-only: it creates nothing.

    # The policy as Terraform renders it, from a plan of infra/staging-apply-role
    terraform -chdir=infra/staging-apply-role show -json role.tfplan > plan.json
    AWS_PROFILE=homecookd python3 infra/scripts/simulate_apply_role.py plan.json

What it proves: every call in ALLOW is allowed on staging's real names, and every call in DENY is refused. What it can't prove:
that ALLOW is the whole list Terraform needs. The reads come from a real plan's debug log (every AWS call it made, Oct 31,
provider 6.71.0). The writes come from the provider's source for the types plan_check.py lets through.
It never prints the account id.
"""
import json
import re
import subprocess
import sys

A = "{a}"  # the account id, filled in at run time
R = "us-west-2"
ECS_ROLE = {"iam:PassedToService": "ecs-tasks.amazonaws.com"}
SCHEDULER_ROLE = {"iam:PassedToService": "scheduler.amazonaws.com"}
STATE = f"arn:aws:s3:::homecookd-tfstate-{A}"
BUCKETS = [f"arn:aws:s3:::homecookd-staging-{b}-{A}" for b in ("media", "uploads", "private", "web")]
TD = f"arn:aws:ecs:{R}:{A}:task-definition/homecookd-staging-api:19"
SERVICE = f"arn:aws:ecs:{R}:{A}:service/homecookd-staging/api"
ALARM = f"arn:aws:cloudwatch:{R}:{A}:alarm:homecookd-staging-db-cpu"
LOG = f"arn:aws:logs:{R}:{A}:log-group:/homecookd-staging/api"
QUEUE = f"arn:aws:sqs:{R}:{A}:homecookd-staging-jobs"
SCHEDULE = f"arn:aws:scheduler:{R}:{A}:schedule/default/homecookd-staging-dish-sweep"
SECRET = f"arn:aws:secretsmanager:{R}:{A}:secret:homecookd/staging/SENTRY_DSN_API-abc123"
FUNCTION = f"arn:aws:cloudfront::{A}:function/homecookd-staging-web-rewrite"
TOPIC = f"arn:aws:sns:{R}:{A}:homecookd-staging-alerts"
TASK_ROLE = f"arn:aws:iam::{A}:role/homecookd-staging-api-task"
EXEC_ROLE = f"arn:aws:iam::{A}:role/homecookd-staging-api-execution"
SCHED_ROLE = f"arn:aws:iam::{A}:role/homecookd-staging-scheduler"
SELF = f"arn:aws:iam::{A}:role/homecookd-staging-infra"
DEPLOY = f"arn:aws:iam::{A}:role/homecookd-staging-deploy"

# (actions, resources, context)
ALLOW = [
    # State
    ("s3:ListBucket", [STATE], {"s3:prefix": "staging/terraform.tfstate"}),
    ("s3:GetObject s3:PutObject", [f"{STATE}/staging/terraform.tfstate", f"{STATE}/staging/terraform.tfstate.tflock"], {}),
    ("s3:DeleteObject", [f"{STATE}/staging/terraform.tfstate.tflock"], {}),
    # Reads with no resource level
    (
        "ec2:DescribeAddresses ec2:DescribeAddressesAttribute ec2:DescribeAvailabilityZones ec2:DescribeInternetGateways "
        "ec2:DescribeNatGateways ec2:DescribeNetworkAcls ec2:DescribePrefixLists ec2:DescribeRouteTables "
        "ec2:DescribeSecurityGroupRules ec2:DescribeSecurityGroups ec2:DescribeSubnets ec2:DescribeVpcAttribute "
        "ec2:DescribeVpcEndpoints ec2:DescribeVpcs elasticloadbalancing:DescribeCapacityReservation "
        "elasticloadbalancing:DescribeListenerAttributes elasticloadbalancing:DescribeListeners "
        "elasticloadbalancing:DescribeLoadBalancerAttributes elasticloadbalancing:DescribeLoadBalancers "
        "elasticloadbalancing:DescribeRules elasticloadbalancing:DescribeTags elasticloadbalancing:DescribeTargetGroupAttributes "
        "elasticloadbalancing:DescribeTargetGroups cloudfront:GetCachePolicy cloudfront:GetDistribution "
        "cloudfront:GetOriginAccessControl cloudfront:GetOriginRequestPolicy cloudfront:GetResponseHeadersPolicy "
        "cloudfront:ListCachePolicies cloudfront:ListOriginRequestPolicies cloudfront:ListTagsForResource "
        "ecs:DescribeTaskDefinition logs:DescribeLogGroups ecs:DeregisterTaskDefinition sns:GetSubscriptionAttributes "
        "application-autoscaling:DescribeScalableTargets application-autoscaling:DescribeScalingPolicies application-autoscaling:ListTagsForResource",
        ["*"],
        {},
    ),
    ("rds:DescribeDBInstances", [f"arn:aws:rds:{R}:{A}:db:*"], {}),
    ("logs:DescribeMetricFilters", [LOG], {}),
    ("cloudwatch:DescribeAlarms", [f"arn:aws:cloudwatch:{R}:{A}:alarm:*"], {}),
    # Reads by name
    (
        "s3:GetAccelerateConfiguration s3:GetBucketAcl s3:GetBucketCORS s3:GetBucketLogging s3:GetBucketObjectLockConfiguration "
        "s3:GetBucketPolicy s3:GetBucketPublicAccessBlock s3:GetBucketRequestPayment s3:GetBucketTagging s3:GetBucketVersioning "
        "s3:GetBucketWebsite s3:GetEncryptionConfiguration s3:GetLifecycleConfiguration s3:GetReplicationConfiguration "
        "s3:ListBucket s3:ListTagsForResource",
        BUCKETS,
        {},
    ),
    ("iam:GetRole iam:GetRolePolicy iam:ListAttachedRolePolicies iam:ListRolePolicies", [TASK_ROLE, EXEC_ROLE, DEPLOY, SCHED_ROLE], {}),
    ("ecs:DescribeClusters ecs:ListTagsForResource", [f"arn:aws:ecs:{R}:{A}:cluster/homecookd-staging"], {}),
    ("ecs:DescribeServices ecs:ListTagsForResource", [SERVICE], {}),
    ("ecr:DescribeRepositories ecr:GetLifecyclePolicy ecr:ListTagsForResource", [f"arn:aws:ecr:{R}:{A}:repository/homecookd-staging/api"], {}),
    ("rds:ListTagsForResource", [f"arn:aws:rds:{R}:{A}:db:homecookd-staging", f"arn:aws:rds:{R}:{A}:subgrp:homecookd-staging"], {}),
    ("rds:DescribeDBSubnetGroups", [f"arn:aws:rds:{R}:{A}:subgrp:homecookd-staging"], {}),
    ("sns:GetTopicAttributes sns:ListTagsForResource", [TOPIC], {}),
    ("secretsmanager:DescribeSecret secretsmanager:GetResourcePolicy", [SECRET], {}),
    # Writes, one line per type in plan_check.py's AUTO table
    ("ecs:RegisterTaskDefinition ecs:TagResource ecs:UntagResource", [TD], {}),
    ("iam:PassRole", [TASK_ROLE, EXEC_ROLE], ECS_ROLE),
    ("ecs:UpdateService ecs:TagResource ecs:UntagResource", [SERVICE], {}),
    ("cloudwatch:PutMetricAlarm cloudwatch:DeleteAlarms cloudwatch:ListTagsForResource cloudwatch:TagResource cloudwatch:UntagResource", [ALARM], {}),
    ("logs:CreateLogGroup logs:PutRetentionPolicy logs:DeleteRetentionPolicy logs:ListTagsForResource logs:TagResource logs:UntagResource", [LOG], {}),
    ("sqs:CreateQueue sqs:GetQueueAttributes sqs:GetQueueUrl sqs:ListQueueTags sqs:SetQueueAttributes sqs:TagQueue sqs:UntagQueue", [QUEUE], {}),
    ("scheduler:GetSchedule scheduler:CreateSchedule scheduler:UpdateSchedule scheduler:DeleteSchedule", [SCHEDULE], {}),
    ("iam:PassRole", [SCHED_ROLE], SCHEDULER_ROLE),
    ("secretsmanager:CreateSecret secretsmanager:TagResource", [SECRET], {}),
    ("s3:PutBucketCORS s3:PutLifecycleConfiguration", BUCKETS, {}),
    ("cloudfront:DescribeFunction cloudfront:GetFunction cloudfront:UpdateFunction cloudfront:PublishFunction", [FUNCTION], {}),
    ("sns:Publish", [TOPIC], {}),
]

PRODUCTION = "homecookd-production"
BACKUPS = "homecookd-backups"
ALL_NAMED = [
    # Production, the backups root and bootstrap's bucket and login, by every name they have or would have
    ("s3:ListBucket s3:GetObject s3:PutObject s3:DeleteObject s3:DeleteBucket s3:PutBucketPolicy s3:GetBucketPolicy s3:PutBucketCORS",
     [f"arn:aws:s3:::{n}-{b}-{A}" for n in (PRODUCTION,) for b in ("media", "uploads", "private")] + [f"arn:aws:s3:::{BACKUPS}-{A}", f"arn:aws:s3:::{BACKUPS}-{A}/convex/x.zip"], {}),
    ("s3:GetObject s3:PutObject s3:DeleteObject", [f"{STATE}/production/terraform.tfstate", f"{STATE}/backups/terraform.tfstate", f"{STATE}/staging-apply-role/terraform.tfstate", f"{STATE}/env:/x/terraform.tfstate"], {}),
    ("s3:ListBucket", [STATE], {"s3:prefix": "production/"}),
    ("s3:ListBucket", [STATE], {"s3:prefix": "env:/"}),
    ("s3:DeleteBucket s3:PutBucketPolicy s3:PutBucketPublicAccessBlock s3:PutBucketVersioning", [STATE], {}),
    ("iam:GetRole iam:PassRole iam:UpdateAssumeRolePolicy iam:PutRolePolicy iam:AttachRolePolicy",
     [f"arn:aws:iam::{A}:role/{PRODUCTION}-deploy", f"arn:aws:iam::{A}:role/{PRODUCTION}-api-task", f"arn:aws:iam::{A}:role/{BACKUPS}-task"], ECS_ROLE),
    ("ecs:UpdateService ecs:DescribeServices", [f"arn:aws:ecs:{R}:{A}:service/{PRODUCTION}/api", f"arn:aws:ecs:{R}:{A}:service/{BACKUPS}/job"], {}),
    ("ecs:RegisterTaskDefinition ecs:RunTask", [f"arn:aws:ecs:{R}:{A}:task-definition/{PRODUCTION}-api:1", f"arn:aws:ecs:{R}:{A}:task-definition/{BACKUPS}:1"], {}),
    ("secretsmanager:GetSecretValue secretsmanager:CreateSecret secretsmanager:DescribeSecret",
     [f"arn:aws:secretsmanager:{R}:{A}:secret:homecookd/production/ANTHROPIC_API_KEY-abc123", f"arn:aws:secretsmanager:{R}:{A}:secret:homecookd/backups/CONVEX_DEPLOY_KEY-abc123"], {}),
    ("sqs:SetQueueAttributes sqs:CreateQueue", [f"arn:aws:sqs:{R}:{A}:{PRODUCTION}-jobs"], {}),
    ("cloudwatch:PutMetricAlarm cloudwatch:DeleteAlarms", [f"arn:aws:cloudwatch:{R}:{A}:alarm:{PRODUCTION}-db-cpu", f"arn:aws:cloudwatch:{R}:{A}:alarm:{BACKUPS}-missed"], {}),
    ("logs:CreateLogGroup logs:PutRetentionPolicy", [f"arn:aws:logs:{R}:{A}:log-group:/{PRODUCTION}/api", f"arn:aws:logs:{R}:{A}:log-group:/{BACKUPS}/job"], {}),
    ("logs:DescribeMetricFilters", [f"arn:aws:logs:{R}:{A}:log-group:/{PRODUCTION}/api"], {}),
    ("scheduler:CreateSchedule scheduler:UpdateSchedule scheduler:DeleteSchedule", [f"arn:aws:scheduler:{R}:{A}:schedule/default/{BACKUPS}", f"arn:aws:scheduler:{R}:{A}:schedule/default/{PRODUCTION}-x"], {}),
    ("sns:Publish", [f"arn:aws:sns:{R}:{A}:{PRODUCTION}-alerts", f"arn:aws:sns:{R}:{A}:{BACKUPS}-alerts"], {}),
    ("rds:DeleteDBInstance rds:ModifyDBInstance", [f"arn:aws:rds:{R}:{A}:db:{PRODUCTION}"], {}),
]
DENY = ALL_NAMED + [
    # Its own trust and permissions, and every way of changing any role
    ("iam:UpdateAssumeRolePolicy iam:PutRolePolicy iam:DeleteRolePolicy iam:AttachRolePolicy iam:DetachRolePolicy iam:CreatePolicyVersion "
     "iam:PutRolePermissionsBoundary iam:DeleteRolePermissionsBoundary iam:DeleteRole iam:TagRole iam:UpdateRole",
     [SELF, DEPLOY, TASK_ROLE, EXEC_ROLE, SCHED_ROLE], {}),
    ("iam:CreateRole iam:CreateUser iam:CreateAccessKey iam:CreatePolicy iam:CreateOpenIDConnectProvider iam:UpdateOpenIDConnectProviderThumbprint", ["*"], {}),
    # Can't pass itself or the deploy role to anything, or a task role to anything but ECS.
    ("iam:PassRole", [SELF, DEPLOY], ECS_ROLE),
    ("iam:PassRole", [TASK_ROLE], {"iam:PassedToService": "lambda.amazonaws.com"}),
    ("iam:PassRole", [SCHED_ROLE], ECS_ROLE),
    ("sts:AssumeRole", ["*", SELF, DEPLOY], {}),
    # Rule 1: the database and buckets can't be deleted or changed, on staging either
    ("rds:DeleteDBInstance rds:ModifyDBInstance rds:CreateDBInstance rds:RestoreDBInstanceFromDBSnapshot", [f"arn:aws:rds:{R}:{A}:db:homecookd-staging"], {}),
    ("s3:DeleteBucket s3:CreateBucket", BUCKETS, {}),
    ("s3:GetObject s3:PutObject s3:DeleteObject s3:DeleteObjectVersion", [b + "/x" for b in BUCKETS], {}),
    # Rule 4: nothing that opens staging up, on any name
    ("s3:PutBucketPolicy s3:DeleteBucketPolicy s3:PutBucketPublicAccessBlock s3:PutBucketAcl s3:PutBucketWebsite s3:PutBucketVersioning", BUCKETS, {}),
    ("ec2:AuthorizeSecurityGroupIngress ec2:RevokeSecurityGroupIngress ec2:ModifySecurityGroupRules ec2:CreateSecurityGroup ec2:CreateRoute ec2:ReplaceRoute "
     "ec2:AssociateRouteTable ec2:CreateInternetGateway ec2:AttachInternetGateway ec2:CreateNatGateway ec2:AllocateAddress ec2:CreateVpc ec2:CreateSubnet "
     "ec2:ModifySubnetAttribute ec2:DeleteVpc ec2:DeleteSubnet ec2:DeleteSecurityGroup", ["*"], {}),
    ("elasticloadbalancing:CreateLoadBalancer elasticloadbalancing:CreateListener elasticloadbalancing:ModifyListener elasticloadbalancing:CreateRule "
     "elasticloadbalancing:ModifyRule elasticloadbalancing:SetSecurityGroups elasticloadbalancing:DeleteLoadBalancer", ["*"], {}),
    ("cloudfront:CreateDistribution cloudfront:UpdateDistribution cloudfront:DeleteDistribution cloudfront:CreateFunction cloudfront:DeleteFunction", ["*", FUNCTION], {}),
    # Rule 4: secret values, and reading a secret or running code a merge chose
    ("secretsmanager:GetSecretValue secretsmanager:PutSecretValue secretsmanager:UpdateSecret secretsmanager:DeleteSecret secretsmanager:PutResourcePolicy", [SECRET], {}),
    ("ssm:GetParameter ssm:PutParameter lambda:InvokeFunction lambda:CreateFunction kms:Decrypt", ["*"], {}),
    ("ecs:RunTask ecs:StartTask ecs:ExecuteCommand ecs:CreateService ecs:DeleteService ecs:CreateCluster ecs:DeleteCluster", ["*", TD, SERVICE], {}),
    ("sqs:DeleteQueue sqs:SendMessage sqs:ReceiveMessage", [QUEUE], {}),
    ("logs:DeleteLogGroup", [LOG], {}),
    ("sns:Subscribe sns:SetTopicAttributes sns:DeleteTopic", [TOPIC], {}),
    ("ecr:PutImage ecr:DeleteRepository ecr:SetRepositoryPolicy", [f"arn:aws:ecr:{R}:{A}:repository/homecookd-staging/api"], {}),
    ("organizations:DescribeOrganization budgets:ModifyBudget account:CloseAccount", ["*"], {}),
    # How many tasks staging may run is Caleb's (plan_check.py holds autoscaling), and so is the role AWS makes for it
    ("application-autoscaling:RegisterScalableTarget application-autoscaling:DeregisterScalableTarget application-autoscaling:PutScalingPolicy "
     "application-autoscaling:DeleteScalingPolicy application-autoscaling:TagResource iam:CreateServiceLinkedRole", ["*"], {}),
]


def aws(*args):
    done = subprocess.run(["aws", *args, "--output", "json"], capture_output=True, text=True)
    if done.returncode:
        sys.exit(f"aws {args[0]} {args[1]} failed: {re.sub(r'[0-9]{12}', '<account>', done.stderr)}")
    return done.stdout


def simulate(policy, actions, resources, context):
    entries = [{"ContextKeyName": k, "ContextKeyValues": [v], "ContextKeyType": "string"} for k, v in context.items()]
    args = ["iam", "simulate-custom-policy", "--policy-input-list", policy, "--action-names", *actions.split(), "--resource-arns", *resources]
    if entries:
        args += ["--context-entries", json.dumps(entries)]
    results = json.loads(aws(*args))["EvaluationResults"]
    for r in results:
        # The top-level decision sums up all the resources, so one allowed resource could hide among the denied ones.
        for each in r.get("ResourceSpecificResults") or [{"EvalResourceName": r["EvalResourceName"], "EvalResourceDecision": r["EvalDecision"]}]:
            yield r["EvalActionName"], each["EvalResourceName"], each["EvalResourceDecision"]


def main(plan_path):
    plan = json.load(open(plan_path))
    policy = next(r["change"]["after"]["policy"] for r in plan["resource_changes"] if r["type"] == "aws_iam_role_policy")
    account = json.loads(aws("sts", "get-caller-identity"))["Account"]
    print(f"policy size without spaces: {len(''.join(policy.split()))} of IAM's 10240 for a role's inline policies")
    wrong = 0
    for expected, table in (("allowed", ALLOW), ("denied", DENY)):
        count = 0
        for actions, resources, context in table:
            arns = [r.replace(A, account) for r in resources]
            # The simulator won't take * alongside named resources in one call.
            for group in ([a for a in arns if a == "*"], [a for a in arns if a != "*"]):
                if not group:
                    continue
                for action, resource, decision in simulate(policy, actions, group, context):
                    count += 1
                    if (decision == "allowed") != (expected == "allowed"):
                        wrong += 1
                        print(f"WRONG: {action} on {resource.replace(account, '<account>')} {context}: {decision}, expected {expected}")
        print(f"{expected}: {count} action and resource pairs checked")
    print(f"{wrong} wrong")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
