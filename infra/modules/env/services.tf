resource "aws_ecs_cluster" "main" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "disabled" # about $3 per task a month; turn on when production needs it
  }
}

resource "aws_ecr_repository" "service" {
  for_each             = var.services
  name                 = "${local.name}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "service" {
  for_each   = var.services
  repository = aws_ecr_repository.service[each.key].name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "keep the last 20 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 20 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "service" {
  for_each          = var.services
  name              = "/${local.name}/${each.key}"
  retention_in_days = 30
}

resource "aws_security_group" "service" {
  for_each = var.services
  name     = "${local.name}-${each.key}"
  vpc_id   = aws_vpc.main.id
}

resource "aws_vpc_security_group_egress_rule" "service_all" {
  for_each          = var.services
  security_group_id = aws_security_group.service[each.key].id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_vpc_security_group_ingress_rule" "service_from_alb" {
  for_each                     = local.lb_services
  security_group_id            = aws_security_group.service[each.key].id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
}

resource "aws_ecs_task_definition" "service" {
  for_each                 = var.services
  family                   = "${local.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.execution[each.key].arn
  task_role_arn            = aws_iam_role.task[each.key].arn

  container_definitions = jsonencode([{
    name         = each.key
    image        = "${aws_ecr_repository.service[each.key].repository_url}:bootstrap"
    essential    = true
    stopTimeout  = 120 # Fargate's maximum; long calls are held by task protection instead (docs/build/AWS-MIGRATION.md)
    portMappings = contains(keys(local.lb_services), each.key) ? [{ containerPort = each.value.port }] : []
    environment = [for k, v in merge(each.value.env, each.value.uses_database ? { DB_HOST = aws_db_instance.main.address } : {}, {
      PORT                = tostring(each.value.port)
      MEDIA_BUCKET        = aws_s3_bucket.media.bucket
      UPLOAD_BUCKET       = aws_s3_bucket.uploads.bucket
      PRIVATE_BUCKET      = aws_s3_bucket.private.bucket
      JOBS_QUEUE_URL      = aws_sqs_queue.jobs.url
      SCHEDULED_QUEUE_URL = aws_sqs_queue.scheduled.url
      DEPLOY_ENV          = var.environment
    }) : { name = k, value = v }]
    secrets = concat(
      [for s in each.value.secrets : { name = s, valueFrom = aws_secretsmanager_secret.app[s].arn }],
      each.value.uses_database ? [{ name = "DB_CREDENTIALS", valueFrom = aws_db_instance.main.master_user_secret[0].secret_arn }] : [],
    )
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.service[each.key].name
        awslogs-region        = local.region
        awslogs-stream-prefix = each.key
      }
    }
  }])
}

resource "aws_ecs_service" "service" {
  for_each        = var.services
  name            = each.key
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.service[each.key].arn
  desired_count   = each.value.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.service[each.key].id]
  }

  dynamic "load_balancer" {
    for_each = contains(keys(local.lb_services), each.key) ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.service[each.key].arn
      container_name   = each.key
      container_port   = each.value.port
    }
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # Each deploy registers its own task definition from CI (.github/workflows/deploy-aws.yml); Terraform doesn't undo it.
  lifecycle {
    ignore_changes = [task_definition]
  }

  depends_on = [aws_lb_listener.main]
}
