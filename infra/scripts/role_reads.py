"""What the staging apply role must be able to read: every resource and data source type in infra/envs/staging and the modules it
uses, with the AWS calls the provider makes to refresh it. A plan refreshes everything in the state first, so one read the role lacks
stops every apply. That happened on Nov 2: #253 added the dish budget's metric filter after the role was written.

From a real plan's debug log (Nov 2, provider 6.71.0): `TF_LOG=debug terraform plan`, then each "HTTP Request Sent" line's
tf_resource_type and rpc.method. Some calls are logged under the provider instead of a type, and those types' reads come from the Oct 31
log the role was written from. A type whose data is worked out locally has no reads.

test_plan_check.py fails when a type in the config isn't listed here, when one listed here is gone, and when the role's policy
(infra/staging-apply-role/main.tf) doesn't name a read. Adding a read is an IAM change, so Caleb re-applies that root by hand.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STAGING = ROOT / "infra/envs/staging"
ROLE = ROOT / "infra/staging-apply-role/main.tf"

READS = {
    # From the provider's source (6.71.0: appautoscaling/target.go and policy.go; the target's tags are read with the type), not a debug
    # log: no target existed yet to refresh. Check them against one after the first apply.
    "aws_appautoscaling_policy": ["application-autoscaling:DescribeScalingPolicies"],
    "aws_appautoscaling_target": ["application-autoscaling:DescribeScalableTargets", "application-autoscaling:ListTagsForResource"],
    "aws_cloudfront_cache_policy": ["cloudfront:GetCachePolicy"],
    "aws_cloudfront_distribution": ["cloudfront:GetDistribution", "cloudfront:ListTagsForResource"],
    "aws_cloudfront_function": ["cloudfront:DescribeFunction", "cloudfront:GetFunction", "cloudfront:ListTagsForResource"],
    "aws_cloudfront_origin_access_control": ["cloudfront:GetOriginAccessControl"],
    "aws_cloudfront_response_headers_policy": ["cloudfront:GetResponseHeadersPolicy"],
    "aws_cloudwatch_log_group": ["logs:DescribeLogGroups", "logs:ListTagsForResource"],
    "aws_cloudwatch_log_metric_filter": ["logs:DescribeMetricFilters"],
    "aws_cloudwatch_metric_alarm": ["cloudwatch:DescribeAlarms", "cloudwatch:ListTagsForResource"],
    "aws_db_instance": ["rds:DescribeDBInstances", "rds:ListTagsForResource"],
    "aws_db_subnet_group": ["rds:DescribeDBSubnetGroups", "rds:ListTagsForResource"],
    "aws_ecr_lifecycle_policy": ["ecr:GetLifecyclePolicy"],
    "aws_ecr_repository": ["ecr:DescribeRepositories", "ecr:ListTagsForResource"],
    "aws_ecs_cluster": ["ecs:DescribeClusters"],
    "aws_ecs_service": ["ecs:DescribeServices"],
    "aws_ecs_task_definition": ["ecs:DescribeTaskDefinition"],
    "aws_eip": ["ec2:DescribeAddresses", "ec2:DescribeAddressesAttribute"],
    "aws_iam_role": ["iam:GetRole", "iam:GetRolePolicy", "iam:ListAttachedRolePolicies", "iam:ListRolePolicies"],
    "aws_iam_role_policy": ["iam:GetRolePolicy"],
    "aws_iam_role_policy_attachment": ["iam:ListAttachedRolePolicies"],
    "aws_internet_gateway": ["ec2:DescribeInternetGateways"],
    "aws_lb": ["elasticloadbalancing:DescribeLoadBalancerAttributes", "elasticloadbalancing:DescribeLoadBalancers", "elasticloadbalancing:DescribeTags"],
    "aws_lb_listener": ["elasticloadbalancing:DescribeListeners", "elasticloadbalancing:DescribeListenerAttributes", "elasticloadbalancing:DescribeTags"],
    "aws_lb_listener_rule": ["elasticloadbalancing:DescribeRules", "elasticloadbalancing:DescribeTags"],
    "aws_lb_target_group": ["elasticloadbalancing:DescribeTargetGroups", "elasticloadbalancing:DescribeTargetGroupAttributes", "elasticloadbalancing:DescribeTags"],
    "aws_nat_gateway": ["ec2:DescribeNatGateways"],
    "aws_route_table": ["ec2:DescribeRouteTables"],
    "aws_route_table_association": ["ec2:DescribeRouteTables"],
    "aws_s3_bucket": [
        "s3:GetAccelerateConfiguration", "s3:GetBucketAcl", "s3:GetBucketCORS", "s3:GetBucketLogging", "s3:GetBucketObjectLockConfiguration",
        "s3:GetBucketPolicy", "s3:GetBucketRequestPayment", "s3:GetBucketTagging", "s3:GetBucketVersioning", "s3:GetBucketWebsite",
        "s3:GetEncryptionConfiguration", "s3:GetLifecycleConfiguration", "s3:GetReplicationConfiguration", "s3:ListBucket",
        "s3:ListTagsForResource",
    ],
    "aws_s3_bucket_cors_configuration": ["s3:GetBucketCORS"],
    "aws_s3_bucket_lifecycle_configuration": ["s3:GetLifecycleConfiguration"],
    "aws_s3_bucket_policy": ["s3:GetBucketPolicy"],
    "aws_s3_bucket_public_access_block": ["s3:GetBucketPublicAccessBlock"],
    "aws_s3_bucket_versioning": ["s3:GetBucketVersioning"],
    "aws_scheduler_schedule": ["scheduler:GetSchedule"],
    "aws_secretsmanager_secret": ["secretsmanager:DescribeSecret", "secretsmanager:GetResourcePolicy"],
    "aws_security_group": ["ec2:DescribeSecurityGroups"],
    "aws_sns_topic": ["sns:GetTopicAttributes", "sns:ListTagsForResource"],
    "aws_sns_topic_subscription": ["sns:GetSubscriptionAttributes"],
    "aws_sqs_queue": ["sqs:GetQueueAttributes", "sqs:ListQueueTags"],
    "aws_subnet": ["ec2:DescribeSubnets"],
    "aws_vpc": ["ec2:DescribeVpcs", "ec2:DescribeVpcAttribute", "ec2:DescribeNetworkAcls", "ec2:DescribeRouteTables", "ec2:DescribeSecurityGroups"],
    "aws_vpc_endpoint": ["ec2:DescribeVpcEndpoints", "ec2:DescribePrefixLists"],
    "aws_vpc_security_group_egress_rule": ["ec2:DescribeSecurityGroupRules"],
    "aws_vpc_security_group_ingress_rule": ["ec2:DescribeSecurityGroupRules"],
    "data.aws_availability_zones": ["ec2:DescribeAvailabilityZones"],
    "data.aws_caller_identity": [],  # STS answers whoever asks, with no permission needed
    "data.aws_cloudfront_cache_policy": ["cloudfront:GetCachePolicy", "cloudfront:ListCachePolicies"],
    "data.aws_cloudfront_origin_request_policy": ["cloudfront:GetOriginRequestPolicy", "cloudfront:ListOriginRequestPolicies"],
    "data.aws_iam_policy_document": [],
    "data.aws_region": [],
}


def config_types(staging: Path = STAGING) -> set[str]:
    """Every resource and data source type in the staging root and the local modules it calls."""
    roots = [staging]
    for source in re.findall(r'^\s*source\s*=\s*"(\.\.?/[^"]+)"', (staging / "main.tf").read_text(), re.M):
        roots.append((staging / source).resolve())
    types = set()
    for root in roots:
        for f in sorted(root.glob("*.tf")):
            for kind, name in re.findall(r'^(resource|data) "([a-z0-9_]+)"', f.read_text(), re.M):
                types.add(("data." if kind == "data" else "") + name)
    return types


def granted(role: Path = ROLE) -> set[str]:
    return set(re.findall(r'"([a-z0-9-]+:[A-Za-z0-9]+)"', role.read_text()))


def check(types: set[str] | None = None, allowed: set[str] | None = None, reads: dict | None = None) -> list[str]:
    types = config_types() if types is None else types
    allowed = granted() if allowed is None else allowed
    reads = READS if reads is None else reads
    wrong = [f"role reads: {t} is in the config with no reads listed in role_reads.py (run a debug plan to find them)" for t in sorted(types - reads.keys())]
    wrong += [f"role reads: {t} is listed in role_reads.py and gone from the config" for t in sorted(reads.keys() - types)]
    for t in sorted(types & reads.keys()):
        wrong += [f"role reads: {t} needs {a}, which infra/staging-apply-role/main.tf doesn't grant" for a in reads[t] if a not in allowed]
    return wrong
