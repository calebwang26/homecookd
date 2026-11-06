# terraform test, no AWS and no login. These hold what the deletion promise depends on (docs/build/REGION-COPY.md).
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
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::000000000000:role/mock" }
  }
}

mock_provider "aws" {
  alias = "copy"
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::copy" }
  }
}

variables {
  name                   = "homecookd-test-media-copy"
  source_bucket          = "source"
  old_version_days       = 21
  storage_class          = "STANDARD_IA"
  source_alert_topic_arn = "arn:aws:sns:us-west-2:000000000000:a"
  copy_alert_topic_arn   = "arn:aws:sns:us-east-1:000000000000:a"
}

run "no_age_rule" {
  command = apply

  assert {
    condition     = aws_s3_bucket_replication_configuration.source.rule[0].delete_marker_replication[0].status == "Enabled"
    error_message = "A delete on the source has to reach the copy."
  }

  assert {
    condition     = one(aws_s3_bucket_lifecycle_configuration.copy.rule[0].noncurrent_version_expiration).noncurrent_days == 21
    error_message = "The copy has to remove old bytes itself: S3 doesn't replicate lifecycle deletes."
  }

  assert {
    condition     = aws_s3_bucket_lifecycle_configuration.copy.rule[0].expiration[0].expired_object_delete_marker == true
    error_message = "A live file must not expire by age here: this is the only way to keep it."
  }

  assert {
    condition     = !strcontains(aws_iam_role_policy.replication.policy, "DeleteObject")
    error_message = "The replication role can't destroy a version."
  }

  assert {
    condition     = strcontains(aws_iam_role_policy.replication.policy, "s3:ReplicateDelete")
    error_message = "Without ReplicateDelete, delete markers fail."
  }
}

run "with_an_age_rule" {
  command = apply

  variables {
    current_days     = 21
    old_version_days = 7
  }

  assert {
    condition     = aws_s3_bucket_lifecycle_configuration.copy.rule[0].expiration[0].days == 21
    error_message = "The source's age rule isn't replicated, so the copy needs the same one."
  }
}
