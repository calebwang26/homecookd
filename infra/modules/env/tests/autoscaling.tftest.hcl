# terraform test, no AWS and no login. A service the autoscaler sizes (autoscaling.tf): off until its switch, then CPU and shedding grow it,
# and 15 quiet minutes shrink it.
# Its load balancer check is on its own port (load_balancer.tf), so a busy task isn't replaced. The runs share one state, in order, the way applies follow each other.
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
  mock_resource "aws_appautoscaling_policy" {
    defaults = { arn = "arn:aws:autoscaling:us-west-2:123456789012:scalingPolicy:test:resource/ecs/service/homecookd-test/api:policyName/test" }
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
    api    = { cpu = 512, memory = 1024, desired_count = 0, autoscale = { min = 2, max = 4 }, health_port = 8081, default_route = true, uses_database = true }
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

  assert {
    condition     = toset(keys(aws_appautoscaling_policy.shedding)) == toset(["api"]) && toset(keys(aws_cloudwatch_metric_alarm.shedding)) == toset(["api"])
    error_message = "Only the api scales on shedding: the line it counts is the api's. Off, the range of 0 to 0 caps it at nothing."
  }

  assert {
    condition     = toset(keys(aws_appautoscaling_policy.scale_in)) == toset(["api"]) && toset(keys(aws_cloudwatch_metric_alarm.scale_in)) == toset(["api"])
    error_message = "Only the api, which shedding grows, has the slow scale-in. Services without autoscale get none of it."
  }
}

run "health_check_on_its_own_port" {
  command = apply

  assert {
    condition = alltrue([for h in aws_lb_target_group.service["api"].health_check : (
      h.path == "/health" && h.port == "8081" && h.interval == 15 && h.timeout == 10 && h.healthy_threshold == 2 && h.unhealthy_threshold == 5
    )])
    error_message = "The load balancer checks the api on its health thread's port, and allows 10 s and 5 misses before it gives up on a task."
  }

  assert {
    condition = alltrue([for h in aws_lb_target_group.service["voice"].health_check : (
      h.port == "traffic-port" && h.timeout == 10 && h.unhealthy_threshold == 5
    )])
    error_message = "A service without a health_port is checked on its own port, with the same longer tolerances."
  }

  assert {
    condition = (
      toset(keys(aws_vpc_security_group_ingress_rule.service_health_from_alb)) == toset(["api"])
      && aws_vpc_security_group_ingress_rule.service_health_from_alb["api"].from_port == 8081
      && aws_vpc_security_group_ingress_rule.service_health_from_alb["api"].to_port == 8081
      && aws_vpc_security_group_ingress_rule.service_health_from_alb["api"].referenced_security_group_id == aws_security_group.alb.id
      && aws_vpc_security_group_ingress_rule.service_health_from_alb["api"].security_group_id == aws_security_group.service["api"].id
    )
    error_message = "Only the load balancer may reach the api's health port, and only the api has one."
  }

  assert {
    condition = (
      jsondecode(aws_ecs_task_definition.service["api"].container_definitions)[0].portMappings == [{ containerPort = 8080 }, { containerPort = 8081 }]
      && contains(jsondecode(aws_ecs_task_definition.service["api"].container_definitions)[0].environment, { name = "HEALTH_PORT", value = "8081" })
      && jsondecode(aws_ecs_task_definition.service["voice"].container_definitions)[0].portMappings == [{ containerPort = 8080 }]
    )
    error_message = "The api's task maps the health port and is told it; voice keeps its one port."
  }
}

run "launched" {
  command = apply

  variables {
    services = {
      api    = { cpu = 512, memory = 1024, desired_count = 2, autoscale = { min = 2, max = 4 }, health_port = 8081, default_route = true, uses_database = true }
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
      c.target_value == 50 && c.scale_out_cooldown == 60
      && c.predefined_metric_specification[0].predefined_metric_type == "ECSServiceAverageCPUUtilization"
    )]) && aws_appautoscaling_policy.cpu["api"].resource_id == aws_appautoscaling_target.service["api"].resource_id
    error_message = "The api's tasks are kept near 50% CPU on average (60% grew too late on Nov 2)."
  }

  assert {
    condition     = alltrue([for c in aws_appautoscaling_policy.cpu["api"].target_tracking_scaling_policy_configuration : c.disable_scale_in == true])
    error_message = "CPU tracking only adds api tasks: on Nov 2 its scale-in undid a task shedding had just added. The scale_in policy takes them away."
  }

  assert {
    condition = aws_appautoscaling_policy.scale_in["api"].policy_type == "StepScaling" && alltrue([
      for c in aws_appautoscaling_policy.scale_in["api"].step_scaling_policy_configuration : (
        c.adjustment_type == "ChangeInCapacity" && c.cooldown == 300 && c.metric_aggregation_type == "Maximum" && length(c.step_adjustment) == 1
        && alltrue([for s in c.step_adjustment : s.scaling_adjustment == -1 && s.metric_interval_upper_bound == "0" && s.metric_interval_lower_bound == null])
      )
    ]) && aws_appautoscaling_policy.scale_in["api"].resource_id == aws_appautoscaling_target.service["api"].resource_id
    error_message = "Scale-in takes one api task away at a time, 5 minutes apart, on the same target, so the min still holds."
  }

  assert {
    condition = (
      aws_cloudwatch_metric_alarm.scale_in["api"].evaluation_periods == 15
      && aws_cloudwatch_metric_alarm.scale_in["api"].datapoints_to_alarm == 15
      && aws_cloudwatch_metric_alarm.scale_in["api"].threshold == 25
      && aws_cloudwatch_metric_alarm.scale_in["api"].comparison_operator == "LessThanThreshold"
      && aws_cloudwatch_metric_alarm.scale_in["api"].treat_missing_data == "notBreaching"
      && aws_cloudwatch_metric_alarm.scale_in["api"].alarm_actions == toset([aws_appautoscaling_policy.scale_in["api"].arn])
    )
    error_message = "15 minutes in a row under 25%, missing minutes not counted as quiet, runs the scale-in policy and nothing else."
  }

  assert {
    condition = (
      toset([for q in aws_cloudwatch_metric_alarm.scale_in["api"].metric_query : q.id]) == toset(["quiet", "cpu", "busy"])
      && [for q in aws_cloudwatch_metric_alarm.scale_in["api"].metric_query : q.expression if q.return_data == true] == ["cpu + 100 * busy"]
      && alltrue([for q in aws_cloudwatch_metric_alarm.scale_in["api"].metric_query : alltrue([for m in q.metric : (
        m.namespace == "AWS/ECS" && m.metric_name == "CPUUtilization" && m.stat == "Average" && m.period == 60
        && m.dimensions == tomap({ ClusterName = "homecookd-test", ServiceName = "api" })
      )]) if q.id == "cpu"])
      && alltrue([for q in aws_cloudwatch_metric_alarm.scale_in["api"].metric_query : alltrue([for m in q.metric : (
        m.namespace == aws_cloudwatch_log_metric_filter.api_busy.metric_transformation[0].namespace
        && m.metric_name == aws_cloudwatch_log_metric_filter.api_busy.metric_transformation[0].name
        && m.stat == "Sum" && m.period == 60
      )]) if q.id == "busy"])
    )
    error_message = "A minute is quiet only with the api's average CPU under 25 and no request turned away: CPU plus 100 for each shedding line."
  }

  assert {
    condition = aws_appautoscaling_policy.shedding["api"].policy_type == "StepScaling" && alltrue([
      for c in aws_appautoscaling_policy.shedding["api"].step_scaling_policy_configuration : (
        c.adjustment_type == "ChangeInCapacity" && c.cooldown == 60 && length(c.step_adjustment) == 1
        && alltrue([for s in c.step_adjustment : s.scaling_adjustment == 1 && s.metric_interval_lower_bound == "0" && s.metric_interval_upper_bound == null])
      )
    ]) && aws_appautoscaling_policy.shedding["api"].resource_id == aws_appautoscaling_target.service["api"].resource_id
    error_message = "Shedding adds one api task at a time, at most once a minute, on the same target, so its max still caps it."
  }

  assert {
    condition = (
      aws_cloudwatch_metric_alarm.shedding["api"].metric_name == aws_cloudwatch_log_metric_filter.api_busy.metric_transformation[0].name
      && aws_cloudwatch_metric_alarm.shedding["api"].namespace == "homecookd/homecookd-test"
      && aws_cloudwatch_metric_alarm.shedding["api"].statistic == "Sum"
      && aws_cloudwatch_metric_alarm.shedding["api"].period == 60
      && aws_cloudwatch_metric_alarm.shedding["api"].evaluation_periods == 1
      && aws_cloudwatch_metric_alarm.shedding["api"].threshold == 10
      && aws_cloudwatch_metric_alarm.shedding["api"].comparison_operator == "GreaterThanOrEqualToThreshold"
      && aws_cloudwatch_metric_alarm.shedding["api"].treat_missing_data == "notBreaching"
      && aws_cloudwatch_metric_alarm.shedding["api"].alarm_actions == toset([aws_appautoscaling_policy.shedding["api"].arn])
    )
    error_message = "One minute with 10 or more \"too busy to answer\" lines runs the step policy, and nothing else: no email, no other action."
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
      api    = { cpu = 512, memory = 1024, desired_count = 2, autoscale = { min = 2, max = 4 }, health_port = 8081, default_route = true, uses_database = true }
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
