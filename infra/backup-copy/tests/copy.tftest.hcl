# terraform test, no AWS and no login: the mock provider stands in for it. These hold the rules REGION-COPY.md relies on.
mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "000000000000" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{}" }
  }
  mock_data "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::source" }
  }
  mock_data "aws_db_instance" {
    defaults = { db_instance_arn = "arn:aws:rds:us-west-2:000000000000:db:source" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::000000000000:role/mock" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::copy" }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:us-west-2:000000000000:mock" }
  }
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:us-east-1:000000000000:key/mock" }
  }
}

mock_provider "aws" {
  alias = "copy"
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{}" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::copy" }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:us-east-1:000000000000:mock" }
  }
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:us-east-1:000000000000:key/mock" }
  }
}

run "off_by_default" {
  command = plan

  assert {
    condition     = length(module.bucket) == 0 && length(aws_sns_topic.source_alerts) == 0 && length(aws_kms_key.db_copy) == 0 && length(aws_db_instance_automated_backups_replication.db) == 0
    error_message = "With no variables set, this root must create nothing."
  }
}

run "production_and_convex" {
  command = apply

  variables {
    source_environments = ["production"]
    copy_convex_backups = true
  }

  assert {
    condition     = length(module.bucket) == 4
    error_message = "media, uploads, private and the Convex backups."
  }

  assert {
    condition     = aws_db_instance_automated_backups_replication.db["production"].retention_period == 7
    error_message = "The database copy's default retention."
  }
}

run "refuses_retention_past_the_promise" {
  command = plan

  variables {
    db_copy_days = 29
  }

  expect_failures = [var.db_copy_days]
}

run "refuses_the_same_region" {
  command = plan

  variables {
    copy_region = "us-west-2"
  }

  expect_failures = [var.copy_region]
}
