# Video jobs, for the worker. A job that fails 3 times moves to the dead-letter queue, which raises an alert.
resource "aws_sqs_queue" "jobs_dead" {
  name                      = "${local.name}-jobs-dead"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "jobs" {
  name                       = "${local.name}-jobs"
  visibility_timeout_seconds = 7200 # a long video can take this long; the worker can extend it
  message_retention_seconds  = 1209600
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.jobs_dead.arn
    maxReceiveCount     = 3
  })
}

# The target for EventBridge schedules: Convex's 8 crons become schedules here as each area moves (phase 6).
resource "aws_sqs_queue" "scheduled_dead" {
  name                      = "${local.name}-scheduled-dead"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "scheduled" {
  name                       = "${local.name}-scheduled"
  visibility_timeout_seconds = 300
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.scheduled_dead.arn
    maxReceiveCount     = 3
  })
}

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${local.name}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

resource "aws_iam_role_policy" "scheduler" {
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sqs:SendMessage", Resource = aws_sqs_queue.scheduled.arn }]
  })
}
