# One S3 bucket's copy in the second region: a versioned bucket there, the replication rule on the source, the copy's own
# expiry, and two alarms. docs/build/REGION-COPY.md explains how deletions reach it.
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 6.0"
      configuration_aliases = [aws.copy]
    }
  }
}

data "aws_caller_identity" "current" {}

# Reading it first means a missing source fails the plan, not halfway through an apply.
data "aws_s3_bucket" "source" {
  bucket = var.source_bucket
}

resource "aws_s3_bucket" "copy" {
  provider = aws.copy
  bucket   = "${var.name}-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "copy" {
  provider                = aws.copy
  bucket                  = aws_s3_bucket.copy.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "copy" {
  provider = aws.copy
  bucket   = aws_s3_bucket.copy.id
  versioning_configuration { status = "Enabled" }
}

# S3 never replicates what a lifecycle rule does, so the copy needs its own rule for every expiry the source has.
resource "aws_s3_bucket_lifecycle_configuration" "copy" {
  provider   = aws.copy
  bucket     = aws_s3_bucket.copy.id
  depends_on = [aws_s3_bucket_versioning.copy]
  rule {
    id     = "expire"
    status = "Enabled"
    filter {}
    expiration {
      days                         = var.current_days
      expired_object_delete_marker = var.current_days == null ? true : null
    }
    noncurrent_version_expiration { noncurrent_days = var.old_version_days }
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}

data "aws_iam_policy_document" "s3_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "replication" {
  name               = "${var.name}-replication"
  assume_role_policy = data.aws_iam_policy_document.s3_assume.json
}

# Read the source's versions, write to the copy. ReplicateDelete writes delete markers. It can't remove any version.
resource "aws_iam_role_policy" "replication" {
  role = aws_iam_role.replication.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetReplicationConfiguration", "s3:ListBucket"]
        Resource = data.aws_s3_bucket.source.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl", "s3:GetObjectVersionTagging"]
        Resource = "${data.aws_s3_bucket.source.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ReplicateObject", "s3:ReplicateDelete", "s3:ReplicateTags"]
        Resource = "${aws_s3_bucket.copy.arn}/*"
      },
    ]
  })
}

resource "aws_s3_bucket_replication_configuration" "source" {
  bucket     = var.source_bucket
  role       = aws_iam_role.replication.arn
  depends_on = [aws_s3_bucket_versioning.copy, aws_iam_role_policy.replication]
  rule {
    id     = "copy"
    status = "Enabled"
    filter {} # the whole bucket; a tag filter would turn off delete markers
    delete_marker_replication { status = "Enabled" }
    destination {
      bucket        = aws_s3_bucket.copy.arn
      storage_class = var.storage_class
      metrics { status = "Enabled" }
    }
  }
}

# A delete marker that fails doesn't come back on its own, and the copy would keep that file: see REGION-COPY.md, "When an alarm fires".
# S3 publishes this metric in the source's region.
resource "aws_cloudwatch_metric_alarm" "failed" {
  alarm_name          = "${var.name}-failed"
  alarm_description   = "A file or a deletion didn't reach the second region. Runbook: docs/build/REGION-COPY.md, When an alarm fires"
  namespace           = "AWS/S3"
  metric_name         = "OperationsFailedReplication"
  dimensions          = { SourceBucket = var.source_bucket, DestinationBucket = aws_s3_bucket.copy.bucket, RuleId = "copy" }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.source_alert_topic_arn]
}

# And this one in the copy's region, so its alarm and topic live there.
resource "aws_cloudwatch_metric_alarm" "behind" {
  provider            = aws.copy
  alarm_name          = "${var.name}-behind"
  alarm_description   = "The second region is over 6 hours behind. Runbook: docs/build/REGION-COPY.md, When an alarm fires"
  namespace           = "AWS/S3"
  metric_name         = "ReplicationLatency"
  dimensions          = { SourceBucket = var.source_bucket, DestinationBucket = aws_s3_bucket.copy.bucket, RuleId = "copy" }
  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 21600
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.copy_alert_topic_arn]
}
