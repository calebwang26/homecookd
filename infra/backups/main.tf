# Daily Convex exports to S3 (phase 0, docs/build/AWS-MIGRATION.md). Its own small network, so tearing staging down
# can't stop the backups. The job only needs to reach Convex and S3: no NAT gateway, no inbound access.
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    key          = "backups/terraform.tfstate"
    region       = "us-west-2"
    use_lockfile = true
    # bucket comes from: terraform init -backend-config="bucket=homecookd-tfstate-<account id>"
  }
}

provider "aws" {
  region = "us-west-2"
  default_tags {
    tags = { Project = "homecookd", Environment = "backups", ManagedBy = "terraform" }
  }
}

variable "job_count_enabled" {
  description = "false until the first image is pushed and the key is in place (infra/README.md)"
  type        = bool
  default     = false
}

data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" { state = "available" }

locals {
  name       = "homecookd-backups"
  account_id = data.aws_caller_identity.current.account_id
}

resource "aws_s3_bucket" "backups" {
  bucket = "${local.name}-${local.account_id}"
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration { status = "Enabled" }
}

# /privacy promises a deleted account's data leaves backups within 30 days of its deletion. Don't raise this past that.
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket     = aws_s3_bucket.backups.id
  depends_on = [aws_s3_bucket_versioning.backups]
  rule {
    id     = "expire"
    status = "Enabled"
    filter {}
    expiration { days = 28 }
    noncurrent_version_expiration { noncurrent_days = 1 }
    abort_incomplete_multipart_upload { days_after_initiation = 2 }
  }
}

resource "aws_secretsmanager_secret" "convex_key" {
  name                    = "homecookd/backups/CONVEX_DEPLOY_KEY"
  recovery_window_in_days = 7
}

resource "aws_vpc" "main" {
  cidr_block = "10.40.0.0/24"
  tags       = { Name = local.name }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.40.0.0/25"
  availability_zone = data.aws_availability_zones.available.names[0]
  tags              = { Name = "${local.name}-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "job" {
  name   = local.name
  vpc_id = aws_vpc.main.id
}

resource "aws_vpc_security_group_egress_rule" "job_https" {
  security_group_id = aws_security_group.job.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_ecr_repository" "job" {
  name                 = local.name
  image_tag_mutability = "MUTABLE" # the task runs :latest; the job is small and rebuilt by hand
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecs_cluster" "main" {
  name = local.name
}

resource "aws_cloudwatch_log_group" "job" {
  name              = "/${local.name}/job"
  retention_in_days = 90
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_base" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secret" {
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = aws_secretsmanager_secret.convex_key.arn }]
  })
}

# The job can add a backup. It can't read or delete one, so a stolen key can't erase the history.
resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "task" {
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "s3:PutObject", Resource = "${aws_s3_bucket.backups.arn}/convex/*" },
      {
        Effect    = "Allow"
        Action    = "cloudwatch:PutMetricData"
        Resource  = "*" # this action can't name a resource; the condition limits it
        Condition = { StringEquals = { "cloudwatch:namespace" = "homecookd/backups" } }
      },
    ]
  })
}

resource "aws_ecs_task_definition" "job" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  ephemeral_storage { size_in_gib = 50 }

  container_definitions = jsonencode([{
    name        = "job"
    image       = "${aws_ecr_repository.job.repository_url}:latest"
    essential   = true
    environment = [{ name = "BACKUP_BUCKET", value = aws_s3_bucket.backups.bucket }, { name = "AWS_REGION", value = "us-west-2" }]
    secrets     = [{ name = "CONVEX_DEPLOY_KEY", valueFrom = aws_secretsmanager_secret.convex_key.arn }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.job.name
        awslogs-region        = "us-west-2"
        awslogs-stream-prefix = "job"
      }
    }
  }])
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
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "ecs:RunTask", Resource = "arn:aws:ecs:us-west-2:${local.account_id}:task-definition/${local.name}:*" },
      { Effect = "Allow", Action = "iam:PassRole", Resource = [aws_iam_role.execution.arn, aws_iam_role.task.arn] },
    ]
  })
}

resource "aws_scheduler_schedule" "daily" {
  name                = local.name
  state               = var.job_count_enabled ? "ENABLED" : "DISABLED"
  schedule_expression = "cron(0 10 * * ? *)" # 3am Pacific
  flexible_time_window { mode = "OFF" }
  target {
    arn      = aws_ecs_cluster.main.arn
    role_arn = aws_iam_role.scheduler.arn
    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.job.arn
      launch_type         = "FARGATE"
      network_configuration {
        subnets          = [aws_subnet.public.id]
        security_groups  = [aws_security_group.job.id]
        assign_public_ip = true
      }
    }
  }
}

# Alerts: one when a run fails, one when no backup landed for a day (covers a schedule that silently stopped).
resource "aws_sns_topic" "alerts" {
  name = "${local.name}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = "caleb.wang26@gmail.com"
}

resource "aws_sns_topic_policy" "alerts" {
  arn = aws_sns_topic.alerts.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sns:Publish"
      Resource  = aws_sns_topic.alerts.arn
    }]
  })
}

resource "aws_cloudwatch_event_rule" "failed" {
  name = "${local.name}-failed"
  event_pattern = jsonencode({
    source        = ["aws.ecs"]
    "detail-type" = ["ECS Task State Change"]
    detail = {
      clusterArn = [aws_ecs_cluster.main.arn]
      lastStatus = ["STOPPED"]
      containers = { exitCode = [{ "anything-but" = 0 }] }
    }
  })
}

resource "aws_cloudwatch_event_target" "failed" {
  rule = aws_cloudwatch_event_rule.failed.name
  arn  = aws_sns_topic.alerts.arn
}

resource "aws_cloudwatch_metric_alarm" "missed" {
  count               = var.job_count_enabled ? 1 : 0
  alarm_name          = "${local.name}-missed"
  alarm_description   = "No Convex backup landed in S3 for a day"
  namespace           = "homecookd/backups"
  metric_name         = "ConvexBackupDone"
  statistic           = "Sum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

output "bucket" { value = aws_s3_bucket.backups.bucket }
output "repository_url" { value = aws_ecr_repository.job.repository_url }
