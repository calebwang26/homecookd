# The role .github/workflows/apply-staging.yml logs in with to plan and apply infra/envs/staging. It lives in its own root,
# applied once by Caleb with his own login, so a merge can't widen it: the workflow only ever applies infra/envs/staging, this
# root's state is outside what the role can read, and the role holds no IAM write at all.
#
# It can do exactly what infra/scripts/plan_check.py lets through by itself, and no more. Everything the check sends to Caleb
# (IAM, the network, the load balancer, CloudFront's distributions, the database, buckets and their policies) he applies with
# his own login. So the role is the real wall, and it still holds if a merge rewrites the check.
#
# infra/scripts/simulate_apply_role.py checks this policy against AWS's policy simulator. Widening it is a change to this file
# plus an apply by Caleb, and the two lists there and the table in plan_check.py change with it.
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    key          = "staging-apply-role/terraform.tfstate"
    region       = "us-west-2"
    use_lockfile = true
    # bucket comes from: terraform init -backend-config="bucket=homecookd-tfstate-<account id>"
  }
}

provider "aws" {
  region = "us-west-2"
  default_tags {
    tags = { Project = "homecookd", Environment = "staging", ManagedBy = "terraform" }
  }
}

variable "github_subject_prefix" {
  description = "This repo as GitHub's login names it, with its permanent ids: gh api repos/<repo>/actions/oidc/customization/sub"
  type        = string
  default     = "repo:calebwang26@292613801/homecookd@1431696591"
}

variable "github_repo" {
  description = "owner/name. GitHub's job_workflow_ref claim uses the name, so renaming the repo stops this login until this changes"
  type        = string
  default     = "calebwang26/homecookd"
}

variable "branch" {
  description = "The only branch that can log in. Becomes main when aws-migration is merged and retired"
  type        = string
  default     = "aws-migration"
}

data "aws_caller_identity" "current" {}

locals {
  account = data.aws_caller_identity.current.account_id
  region  = "us-west-2"
  oidc    = "token.actions.githubusercontent.com"
  name    = "homecookd-staging"
  arn     = "${local.region}:${local.account}"
}

# Three things must all match: this repo's permanent ids and the GitHub environment (sub), the branch (ref), and this one workflow
# file on that branch (job_workflow_ref). Without ref, any branch with a workflow naming the environment could log in, since
# GitHub environments can't limit branches on this plan. AWS treats a missing claim as no match, so these fail closed.
data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = ["arn:aws:iam::${local.account}:oidc-provider/${local.oidc}"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc}:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc}:sub"
      values   = ["${var.github_subject_prefix}:environment:staging-infra"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc}:ref"
      values   = ["refs/heads/${var.branch}"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc}:job_workflow_ref"
      values   = ["${var.github_repo}/.github/workflows/apply-staging.yml@refs/heads/${var.branch}"]
    }
  }
}

resource "aws_iam_role" "apply" {
  name                 = "${local.name}-infra"
  description          = "GitHub Actions plans and applies infra/envs/staging. Created by hand from infra/staging-apply-role"
  assume_role_policy   = data.aws_iam_policy_document.trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "apply" {
  name = "plan-and-apply-staging"
  role = aws_iam_role.apply.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # Terraform's state: its own folder in the bucket. It can overwrite the state (old versions stay) and can't delete it,
      # only its lock. Listing outside this prefix is denied, and Terraform accepts that for its workspace listing.
      {
        Sid       = "StateList"
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = "arn:aws:s3:::homecookd-tfstate-${local.account}"
        Condition = { StringLike = { "s3:prefix" = ["staging/*"] } }
      },
      {
        Sid      = "StateReadWrite"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "arn:aws:s3:::homecookd-tfstate-${local.account}/staging/*"
      },
      {
        Sid      = "StateLockRelease"
        Effect   = "Allow"
        Action   = "s3:DeleteObject"
        Resource = "arn:aws:s3:::homecookd-tfstate-${local.account}/staging/terraform.tfstate.tflock"
      },

      # Reads that AWS won't limit by name. They show settings, never data or secret values.
      {
        Sid    = "ReadsNoResourceLevel"
        Effect = "Allow"
        Action = [
          "ec2:DescribeAddresses", "ec2:DescribeAddressesAttribute", "ec2:DescribeAvailabilityZones", "ec2:DescribeInternetGateways",
          "ec2:DescribeNatGateways", "ec2:DescribeNetworkAcls", "ec2:DescribePrefixLists", "ec2:DescribeRouteTables",
          "ec2:DescribeSecurityGroupRules", "ec2:DescribeSecurityGroups", "ec2:DescribeSubnets", "ec2:DescribeVpcAttribute",
          "ec2:DescribeVpcEndpoints", "ec2:DescribeVpcs",
          "elasticloadbalancing:DescribeCapacityReservation", "elasticloadbalancing:DescribeListenerAttributes",
          "elasticloadbalancing:DescribeListeners", "elasticloadbalancing:DescribeLoadBalancerAttributes",
          "elasticloadbalancing:DescribeLoadBalancers", "elasticloadbalancing:DescribeRules", "elasticloadbalancing:DescribeTags",
          "elasticloadbalancing:DescribeTargetGroupAttributes", "elasticloadbalancing:DescribeTargetGroups",
          # CloudFront's ARNs hold random ids, not names.
          "cloudfront:GetCachePolicy", "cloudfront:GetDistribution", "cloudfront:GetOriginAccessControl",
          "cloudfront:GetOriginRequestPolicy", "cloudfront:GetResponseHeadersPolicy", "cloudfront:ListCachePolicies",
          "cloudfront:ListOriginRequestPolicies", "cloudfront:ListTagsForResource",
          "ecs:DescribeTaskDefinition", "logs:DescribeLogGroups",
          # AWS's reference names the topic for this one, but the simulator refuses a subscription's ARN under a topic's name.
          "sns:GetSubscriptionAttributes",
          # The api's autoscaling: the two describes take no resource, and a target's ARN holds a random id. Reads only: its writes are Caleb's.
          "application-autoscaling:DescribeScalableTargets", "application-autoscaling:DescribeScalingPolicies",
          "application-autoscaling:ListTagsForResource",
        ]
        Resource = "*"
      },
      # The provider looks these two up with a filter, not a name, so AWS checks them against every database and alarm.
      {
        Sid      = "ReadsFilteredLookups"
        Effect   = "Allow"
        Action   = ["rds:DescribeDBInstances", "cloudwatch:DescribeAlarms"]
        Resource = ["arn:aws:rds:${local.arn}:db:*", "arn:aws:cloudwatch:${local.arn}:alarm:*"]
      },

      # Reads limited to staging's names.
      {
        Sid    = "ReadStagingBuckets"
        Effect = "Allow"
        Action = [
          "s3:GetAccelerateConfiguration", "s3:GetBucketAcl", "s3:GetBucketCORS", "s3:GetBucketLogging",
          "s3:GetBucketObjectLockConfiguration", "s3:GetBucketPolicy", "s3:GetBucketPublicAccessBlock", "s3:GetBucketRequestPayment",
          "s3:GetBucketTagging", "s3:GetBucketVersioning", "s3:GetBucketWebsite", "s3:GetEncryptionConfiguration",
          "s3:GetLifecycleConfiguration", "s3:GetReplicationConfiguration", "s3:ListBucket", "s3:ListTagsForResource",
        ]
        Resource = "arn:aws:s3:::${local.name}-*"
      },
      {
        Sid      = "ReadStagingRoles"
        Effect   = "Allow"
        Action   = ["iam:GetRole", "iam:GetRolePolicy", "iam:ListAttachedRolePolicies", "iam:ListRolePolicies"]
        Resource = "arn:aws:iam::${local.account}:role/${local.name}-*"
      },
      {
        Sid    = "ReadStagingEcs"
        Effect = "Allow"
        Action = ["ecs:DescribeClusters", "ecs:DescribeServices", "ecs:ListTagsForResource"]
        Resource = [
          "arn:aws:ecs:${local.arn}:cluster/${local.name}",
          "arn:aws:ecs:${local.arn}:service/${local.name}/*",
          "arn:aws:ecs:${local.arn}:task-definition/${local.name}-*:*",
        ]
      },
      {
        Sid      = "ReadStagingEcr"
        Effect   = "Allow"
        Action   = ["ecr:DescribeRepositories", "ecr:GetLifecyclePolicy", "ecr:ListTagsForResource"]
        Resource = "arn:aws:ecr:${local.arn}:repository/${local.name}/*"
      },
      {
        Sid      = "ReadStagingRds"
        Effect   = "Allow"
        Action   = ["rds:DescribeDBSubnetGroups", "rds:ListTagsForResource"]
        Resource = ["arn:aws:rds:${local.arn}:db:${local.name}", "arn:aws:rds:${local.arn}:subgrp:${local.name}"]
      },
      {
        Sid      = "ReadStagingSns"
        Effect   = "Allow"
        Action   = ["sns:GetTopicAttributes", "sns:ListTagsForResource"]
        Resource = "arn:aws:sns:${local.arn}:${local.name}-*"
      },
      {
        Sid      = "ReadStagingLogs"
        Effect   = "Allow"
        Action   = ["logs:DescribeMetricFilters"]
        Resource = "arn:aws:logs:${local.arn}:log-group:/${local.name}/*"
      },
      {
        Sid      = "ReadStagingSecretNames"
        Effect   = "Allow"
        Action   = ["secretsmanager:DescribeSecret", "secretsmanager:GetResourcePolicy"]
        Resource = "arn:aws:secretsmanager:${local.arn}:secret:homecookd/staging/*"
      },

      # Writes: each one matches a line of the table in plan_check.py.
      {
        Sid      = "TaskDefinitions"
        Effect   = "Allow"
        Action   = ["ecs:RegisterTaskDefinition"]
        Resource = "arn:aws:ecs:${local.arn}:task-definition/${local.name}-*:*"
      },
      # AWS won't limit this one by name.
      { Sid = "TaskDefinitionsOld", Effect = "Allow", Action = "ecs:DeregisterTaskDefinition", Resource = "*" },
      {
        Sid      = "ServiceCounts"
        Effect   = "Allow"
        Action   = "ecs:UpdateService"
        Resource = "arn:aws:ecs:${local.arn}:service/${local.name}/*"
      },
      {
        Sid    = "EcsTags"
        Effect = "Allow"
        Action = ["ecs:TagResource", "ecs:UntagResource"]
        Resource = [
          "arn:aws:ecs:${local.arn}:service/${local.name}/*",
          "arn:aws:ecs:${local.arn}:task-definition/${local.name}-*:*",
        ]
      },
      # A task definition and a schedule each name a role, and AWS asks for this to name it. It's limited to the service that
      # uses each role. It can't pass this role or the deploy role, and the roles it can pass hold staging's permissions only.
      {
        Sid    = "PassTaskRoles"
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          "arn:aws:iam::${local.account}:role/${local.name}-*-execution",
          "arn:aws:iam::${local.account}:role/${local.name}-*-task",
        ]
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      },
      {
        Sid       = "PassSchedulerRole"
        Effect    = "Allow"
        Action    = "iam:PassRole"
        Resource  = "arn:aws:iam::${local.account}:role/${local.name}-scheduler"
        Condition = { StringEquals = { "iam:PassedToService" = "scheduler.amazonaws.com" } }
      },
      {
        Sid      = "Alarms"
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms", "cloudwatch:ListTagsForResource", "cloudwatch:TagResource", "cloudwatch:UntagResource"]
        Resource = "arn:aws:cloudwatch:${local.arn}:alarm:${local.name}-*"
      },
      {
        Sid      = "LogGroups"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:PutRetentionPolicy", "logs:DeleteRetentionPolicy", "logs:ListTagsForResource", "logs:TagResource", "logs:UntagResource"]
        Resource = "arn:aws:logs:${local.arn}:log-group:/${local.name}/*"
      },
      {
        Sid      = "Queues"
        Effect   = "Allow"
        Action   = ["sqs:CreateQueue", "sqs:GetQueueAttributes", "sqs:GetQueueUrl", "sqs:ListQueueTags", "sqs:SetQueueAttributes", "sqs:TagQueue", "sqs:UntagQueue"]
        Resource = "arn:aws:sqs:${local.arn}:${local.name}-*"
      },
      {
        Sid      = "Schedules"
        Effect   = "Allow"
        Action   = ["scheduler:GetSchedule", "scheduler:CreateSchedule", "scheduler:UpdateSchedule", "scheduler:DeleteSchedule"]
        Resource = "arn:aws:scheduler:${local.arn}:schedule/default/${local.name}-*"
      },
      # A new secret's name, with no value. UpdateSecret, PutSecretValue and GetSecretValue are left out on purpose.
      {
        Sid      = "NewSecretNames"
        Effect   = "Allow"
        Action   = ["secretsmanager:CreateSecret", "secretsmanager:TagResource"]
        Resource = "arn:aws:secretsmanager:${local.arn}:secret:homecookd/staging/*"
      },
      {
        Sid      = "BucketCorsAndLifecycle"
        Effect   = "Allow"
        Action   = ["s3:PutBucketCORS", "s3:PutLifecycleConfiguration"]
        Resource = "arn:aws:s3:::${local.name}-*"
      },
      {
        Sid      = "WebsiteFunction"
        Effect   = "Allow"
        Action   = ["cloudfront:DescribeFunction", "cloudfront:GetFunction", "cloudfront:UpdateFunction", "cloudfront:PublishFunction"]
        Resource = "arn:aws:cloudfront::${local.account}:function/${local.name}-*"
      },

      # Tells Caleb when the workflow stops. Nothing else.
      {
        Sid      = "TellCaleb"
        Effect   = "Allow"
        Action   = "sns:Publish"
        Resource = "arn:aws:sns:${local.arn}:${local.name}-alerts"
      },
    ]
  })
}

output "role_arn" { value = aws_iam_role.apply.arn }
