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

resource "aws_vpc_security_group_ingress_rule" "service_health_from_alb" {
  for_each                     = { for k, s in local.lb_services : k => s if s.health_port != null }
  security_group_id            = aws_security_group.service[each.key].id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = each.value.health_port
  to_port                      = each.value.health_port
}

locals {
  # What a service that uses the database is told. The limited login is only a user name: the task role signs a token for it
  # (iam.tf). The master login is a secret, and with db_iam_login only the migrate task below gets it.
  db_env = { for k, s in var.services : k => merge(
    { DB_HOST = aws_db_instance.main.address },
    var.db_iam_login ? { DB_IAM = "1", DB_USER = local.db_logins[k] } : {},
  ) if s.uses_database }
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

  # Unset = no block, Fargate's free 20 GiB. A video job downloads its clips, then makes frames and a cut (docs/build/WORKER-MIGRATION.md).
  dynamic "ephemeral_storage" {
    for_each = each.value.disk_gib == null ? [] : [each.value.disk_gib]
    content {
      size_in_gib = ephemeral_storage.value
    }
  }

  container_definitions = jsonencode([merge({
    name         = each.key
    image        = "${aws_ecr_repository.service[each.key].repository_url}:bootstrap"
    essential    = true
    stopTimeout  = 120 # Fargate's maximum; long calls are held by task protection instead (docs/build/AWS-MIGRATION.md)
    portMappings = contains(keys(local.lb_services), each.key) ? [for p in [each.value.port, each.value.health_port] : { containerPort = p } if p != null] : []
    environment = [for k, v in merge(each.value.env, lookup(local.db_env, each.key, {}), each.key == "worker" ? { MEDIA_BASE_URL = local.media_url } : {}, each.value.health_port == null ? {} : { HEALTH_PORT = tostring(each.value.health_port) }, {
      PORT                = tostring(each.value.port)
      MEDIA_BUCKET        = aws_s3_bucket.media.bucket
      MEDIA_BASE_URL      = local.media_url
      UPLOAD_BUCKET       = aws_s3_bucket.uploads.bucket
      PRIVATE_BUCKET      = aws_s3_bucket.private.bucket
      JOBS_QUEUE_URL      = aws_sqs_queue.jobs.url
      SCHEDULED_QUEUE_URL = aws_sqs_queue.scheduled.url
      DEPLOY_ENV          = var.environment
    }) : { name = k, value = v }]
    secrets = concat(
      [for s in each.value.secrets : { name = s, valueFrom = aws_secretsmanager_secret.app[s].arn }],
      each.value.uses_database && !var.db_iam_login ? [{ name = "DB_CREDENTIALS", valueFrom = aws_db_instance.main.master_user_secret[0].secret_arn }] : [],
    )
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.service[each.key].name
        awslogs-region        = local.region
        awslogs-stream-prefix = each.key
      }
    }
  }, each.value.entry_point == null ? {} : { entryPoint = each.value.entry_point })])
}

# Migrations, as a one-off task before each api rollout (.github/workflows/deploy-aws.yml, which swaps in that release's image). The
# only task with the master login, because it's the only one that changes the schema. Its role may do nothing in AWS. It runs on the
# api's network, so it reaches the database the same way.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.migrate_execution.arn
  task_role_arn            = aws_iam_role.migrate_task.arn

  container_definitions = jsonencode([{
    name        = "migrate"
    image       = "${aws_ecr_repository.service["api"].repository_url}:bootstrap"
    essential   = true
    command     = ["node", "dist/migrate.js"]
    environment = [{ name = "DB_HOST", value = aws_db_instance.main.address }, { name = "DEPLOY_ENV", value = var.environment }]
    secrets     = [{ name = "DB_CREDENTIALS", valueFrom = aws_db_instance.main.master_user_secret[0].secret_arn }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.service["api"].name
        awslogs-region        = local.region
        awslogs-stream-prefix = "migrate"
      }
    }
  }])
}

locals {
  # An autoscaled service's count belongs to the autoscaler, so it lives in aws_ecs_service.scaled below. Everything else stays here.
  scaled_services = { for k, s in var.services : k => s if s.autoscale != null }
  ecs_services    = merge(aws_ecs_service.service, aws_ecs_service.scaled)
}

resource "aws_ecs_service" "service" {
  for_each        = { for k, s in var.services : k => s if s.autoscale == null }
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

# The same service, for those the autoscaler sizes (autoscaling.tf). Terraform sets the count once, when it creates the service, and
# never again, or each apply would put it back while the autoscaler had grown it. lifecycle can't depend on a variable, so this is a
# second block: keep it the same as the one above in everything else. Moving a running service between the two is a
# `terraform state mv` (infra/README.md, "Autoscaling the api").
resource "aws_ecs_service" "scaled" {
  for_each        = local.scaled_services
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

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  depends_on = [aws_lb_listener.main]
}
