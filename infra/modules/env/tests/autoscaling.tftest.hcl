# terraform test, no AWS and no login. A service the autoscaler sizes (autoscaling.tf): off until its switch, then CPU picks its count.
# The runs share one state, in order, the way applies follow each other.
mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["us-west-2a", "us-west-2b"] }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_region" {
    defaults = { region = "us-west-2" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{}" }
  }
  # The provider still checks that these look like ARNs.
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/test" }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:us-west-2:123456789012:test" }
  }
  mock_resource "aws_lb" {
    defaults = { arn = "arn:aws:elasticloadbalancing:us-west-2:123456789012:loadbalancer/app/test/1" }
  }
  mock_resource "aws_lb_target_group" {
    defaults = { arn = "arn:aws:elasticloadbalancing:us-west-2:123456789012:targetgroup/test/1" }
  }
  mock_resource "aws_lb_listener" {
    defaults = { arn = "arn:aws:elasticloadbalancing:us-west-2:123456789012:listener/app/test/1/1" }
  }
  mock_resource "aws_db_instance" {
    defaults = {
      address            = "db.test"
      resource_id        = "db-TESTONLY"
      master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:us-west-2:123456789012:secret:rds!db-test", kms_key_id = "k", secret_status = "active" }]
    }
  }
}

variables {
  environment       = "test"
  vpc_cidr          = "10.9.0.0/16"
  nat_gateways      = 1
  db_instance_class = "db.t4g.micro"
  db_multi_az       = false
  db_allocated_gb   = 20
  db_backup_days    = 1
  db_protected      = false
  alert_email       = "alerts@example.com"
  secret_names      = ["SENTRY_DSN_API"]
  services = {
    api    = { cpu = 512, memory = 1024, desired_count = 0, autoscale = { min = 2, max = 4 }, default_route = true, uses_database = true }
    worker = { cpu = 1024, memory = 2048, desired_count = 0, uses_database = true }
    voice  = { cpu = 256, memory = 512, desired_count = 0, path_patterns = ["/cook*"] }
  }
}

run "off_until_launch" {
  command = apply

  assert {
    condition     = aws_appautoscaling_target.service["api"].min_capacity == 0 && aws_appautoscaling_target.service["api"].max_capacity == 0
    error_message = "At desired_count 0 the range is 0 to 0, so the autoscaler can't start a task: production until launch."
  }

  assert {
    condition     = aws_ecs_service.scaled["api"].desired_count == 0 && !contains(keys(aws_ecs_service.service), "api")
    error_message = "The api is created with no tasks, in the block whose count Terraform leaves alone."
  }

  assert {
    condition     = aws_appautoscaling_target.service["api"].resource_id == "service/homecookd-test/api" && aws_appautoscaling_target.service["api"].scalable_dimension == "ecs:service:DesiredCount"
    error_message = "The target is the api service's task count."
  }

  assert {
    condition     = !contains(keys(aws_cloudwatch_metric_alarm.service_unhealthy), "api") && !contains(keys(aws_cloudwatch_metric_alarm.service_below_floor), "api")
    error_message = "A service that's off has no task alarms."
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.api_cpu.dimensions.ServiceName == "api"
    error_message = "The CPU alarm still finds the api in its new block."
  }

  assert {
    condition     = toset(keys(aws_ecs_service.service)) == toset(["voice", "worker"]) && toset(keys(aws_appautoscaling_target.service)) == toset(["api"])
    error_message = "Services without autoscale stay where they were, with no target."
  }
}

run "launched" {
  command = apply

  variables {
    services = {
      api    = { cpu = 512, memory = 1024, desired_count = 2, autoscale = { min = 2, max = 4 }, default_route = true, uses_database = true }
      worker = { cpu = 1024, memory = 2048, desired_count = 0, uses_database = true }
      voice  = { cpu = 256, memory = 512, desired_count = 0, path_patterns = ["/cook*"] }
    }
  }

  assert {
    condition     = aws_appautoscaling_target.service["api"].min_capacity == 2 && aws_appautoscaling_target.service["api"].max_capacity == 4
    error_message = "Launch is desired_count 2: the range becomes 2 to 4, and AWS moves the count into it."
  }

  assert {
    condition     = aws_ecs_service.scaled["api"].desired_count == 0
    error_message = "Terraform never sets an autoscaled service's count after creating it, so an apply can't undo what the autoscaler did."
  }

  assert {
    condition = alltrue([for c in aws_appautoscaling_policy.cpu["api"].target_tracking_scaling_policy_configuration : (
      c.target_value == 60 && c.scale_out_cooldown == 60 && c.scale_in_cooldown == 300
      && c.predefined_metric_specification[0].predefined_metric_type == "ECSServiceAverageCPUUtilization"
    )]) && aws_appautoscaling_policy.cpu["api"].resource_id == aws_appautoscaling_target.service["api"].resource_id
    error_message = "The api's tasks are kept near 60% CPU on average."
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.service_below_floor["api"].threshold == 2 && contains(keys(aws_cloudwatch_metric_alarm.service_unhealthy), "api")
    error_message = "Once on, losing one of its two tasks alarms, as does losing both."
  }
}

run "fixed_counts_still_set_by_terraform" {
  command = apply

  variables {
    services = {
      api    = { cpu = 512, memory = 1024, desired_count = 2, autoscale = { min = 2, max = 4 }, default_route = true, uses_database = true }
      worker = { cpu = 1024, memory = 2048, desired_count = 0, uses_database = true }
      voice  = { cpu = 256, memory = 512, desired_count = 1, path_patterns = ["/cook*"] }
    }
  }

  assert {
    condition     = aws_ecs_service.service["voice"].desired_count == 1 && !contains(keys(aws_cloudwatch_metric_alarm.service_below_floor), "voice")
    error_message = "A service without autoscale gets its count from Terraform, as before."
  }
}

run "the_count_is_only_a_switch" {
  command = plan

  variables {
    services = {
      api = { cpu = 512, memory = 1024, desired_count = 3, autoscale = { min = 2, max = 4 }, default_route = true }
    }
  }

  expect_failures = [var.services]
}

run "at_least_one_task_when_on" {
  command = plan

  variables {
    services = {
      api = { cpu = 512, memory = 1024, desired_count = 0, autoscale = { min = 0, max = 4 }, default_route = true }
    }
  }

  expect_failures = [var.services]
}

run "max_not_below_min" {
  command = plan

  variables {
    services = {
      api = { cpu = 512, memory = 1024, desired_count = 3, autoscale = { min = 3, max = 2 }, default_route = true }
    }
  }

  expect_failures = [var.services]
}
