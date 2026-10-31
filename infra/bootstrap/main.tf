# One-time, account-wide pieces: the bucket that holds Terraform's state, the GitHub login for deploys, and the
# budget alerts. State for this folder stays local to whoever applies it: it holds no secrets and is easy to re-import.
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

provider "aws" {
  region = "us-west-2"
  default_tags {
    tags = { Project = "homecookd", ManagedBy = "terraform" }
  }
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "tfstate" {
  bucket = "homecookd-tfstate-${data.aws_caller_identity.current.account_id}"
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lets GitHub Actions log in to AWS without a stored key. Each environment's deploy role says which repo may use it.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

# Created by hand on Oct 31, 2026 and adopted here. Credits and refunds are excluded, or spend reads $0 and it never fires.
import {
  to = aws_budgets_budget.monthly
  id = "${data.aws_caller_identity.current.account_id}:homecookd-monthly-real-spend"
}

resource "aws_budgets_budget" "monthly" {
  name         = "homecookd-monthly-real-spend"
  budget_type  = "COST"
  limit_amount = "1000"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit = false
    include_refund = false
  }

  dynamic "notification" {
    for_each = [100, 500, 1000]
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "ABSOLUTE_VALUE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = ["caleb.wang26@gmail.com"]
    }
  }
}

output "tfstate_bucket" {
  value = aws_s3_bucket.tfstate.bucket
}
