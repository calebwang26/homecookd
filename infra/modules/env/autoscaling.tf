# CPU decides how many tasks an autoscaled service runs, because CPU is what ran out first: the Nov 2 load test held one 0.25 vCPU api task
# at 80% for 50 requests a second while the database sat at 10% (docs/build/AWS-MIGRATION.md).
#
# desired_count is the switch. At 0 the range is 0 to 0, so nothing starts: production until launch. Above 0 it's min to max. AWS moves the
# count into the range as soon as the range changes (RegisterScalableTarget), so turning a service on or off is still one apply.
# The account's first target makes AWS's own role for this (AWSServiceRoleForApplicationAutoScaling_ECSService), so that apply is Caleb's.
resource "aws_appautoscaling_target" "service" {
  for_each           = local.scaled_services
  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.scaled[each.key].name}"
  min_capacity       = each.value.desired_count > 0 ? each.value.autoscale.min : 0
  max_capacity       = each.value.desired_count > 0 ? each.value.autoscale.max : 0
}

# Keeps the tasks' average CPU near 50%. A new task takes about 3 minutes to help: AWS waits for 3 minutes over the target, then Fargate
# starts it and the load balancer checks it twice. From 50%, traffic can grow by more than half in that time before requests wait for CPU.
# It was 60% until the Nov 2 test at 120 a second: its minutes ran 79, 70, 55, 50, 75%, so the 55 broke the 3 in a row and the api grew
# only after 10 minutes. At 50% the first three were over. The max doesn't change, so neither does the most it can cost.
# A task is added a minute after the last one at the soonest. For the api this policy only adds: on Nov 2 its scale-in undid a task
# shedding had just added, so scale_in below takes tasks away instead. A service that scales on CPU alone keeps target tracking's own
# scale-in (15 minutes under the target, then a task every 5 minutes), since nothing else adds tasks for it to undo.
resource "aws_appautoscaling_policy" "cpu" {
  for_each           = local.scaled_services
  name               = "${local.name}-${each.key}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.service[each.key].service_namespace
  scalable_dimension = aws_appautoscaling_target.service[each.key].scalable_dimension
  resource_id        = aws_appautoscaling_target.service[each.key].resource_id

  target_tracking_scaling_policy_configuration {
    target_value       = 50
    scale_out_cooldown = 60
    scale_in_cooldown  = 300
    disable_scale_in   = contains(keys(local.shed_scaled), each.key)
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

locals {
  # The shedding line is the api's own (alerts.tf, api_busy), so only the api scales on it.
  shed_scaled = { for k, s in local.scaled_services : k => s if k == "api" }
}

# Shedding (api/src/overload.ts) means the tasks are already out of CPU, and CPU tracking is slow to say so: on Nov 2 the api turned requests
# away from the first minute and grew only after 10. So a minute with 10 or more "too busy to answer" lines adds one task, and while it keeps
# shedding AWS runs this again each minute, after the 60 s cooldown, never past the target's max. 10 is more than a held row or a blip turns
# away; the test at 120 a second turned away about 800 a minute. Lock and pool waits write the same line, so a stuck row can add a task it
# doesn't need: scale_in below takes it away once the shedding has stopped for 15 minutes. This policy only adds.
resource "aws_appautoscaling_policy" "shedding" {
  for_each           = local.shed_scaled
  name               = "${local.name}-${each.key}-shedding"
  policy_type        = "StepScaling"
  service_namespace  = aws_appautoscaling_target.service[each.key].service_namespace
  scalable_dimension = aws_appautoscaling_target.service[each.key].scalable_dimension
  resource_id        = aws_appautoscaling_target.service[each.key].resource_id

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 60
    metric_aggregation_type = "Maximum"
    step_adjustment {
      metric_interval_lower_bound = 0
      scaling_adjustment          = 1
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "shedding" {
  for_each            = local.shed_scaled
  alarm_name          = "${local.name}-${each.key}-shedding"
  alarm_description   = "The ${each.key} is turning requests away as too busy: one more task, up to its max"
  namespace           = aws_cloudwatch_log_metric_filter.api_busy.metric_transformation[0].namespace
  metric_name         = aws_cloudwatch_log_metric_filter.api_busy.metric_transformation[0].name
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 10
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_appautoscaling_policy.shedding[each.key].arn]
}

# The way back down, slow, for a service shedding also grows. Target tracking took a task away after 15 minutes under 45% CPU, and in the
# Nov 2 rerun its low alarm, still in alarm from the idle minutes before the test, took away the task shedding had added 1.5 minutes earlier
# (docs/build/AWS-MIGRATION.md, "The rerun"). So target tracking only adds, and this takes one task away after 15 quiet minutes in a row,
# then waits 5 minutes before the next. It stays on the same target, so it never goes below the min.
resource "aws_appautoscaling_policy" "scale_in" {
  for_each           = local.shed_scaled
  name               = "${local.name}-${each.key}-scale-in"
  policy_type        = "StepScaling"
  service_namespace  = aws_appautoscaling_target.service[each.key].service_namespace
  scalable_dimension = aws_appautoscaling_target.service[each.key].scalable_dimension
  resource_id        = aws_appautoscaling_target.service[each.key].resource_id

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 300
    metric_aggregation_type = "Maximum"
    step_adjustment {
      metric_interval_upper_bound = 0
      scaling_adjustment          = -1
    }
  }
}

# A quiet minute is one with the tasks' average CPU under 25% and nothing turned away. The alarm watches CPU plus 100 for each "too busy to
# answer" line, so any shedding makes that minute 100 or more. That's what keeps it from undoing shedding: CPU reaches CloudWatch a minute
# or more late, and until it does an alarm judges the minutes it has, the idle ones before a burst. The shedding count is the same point
# the shedding alarm adds a task on, and metric math counts a missing point as 0, so a minute with shedding and no CPU yet is still 100.
# Going from 3 tasks to 2 under 25% leaves them under 38%, and 4 to 3 under 34%, both short of the 50% that adds one back.
resource "aws_cloudwatch_metric_alarm" "scale_in" {
  for_each            = local.shed_scaled
  alarm_name          = "${local.name}-${each.key}-scale-in"
  alarm_description   = "The ${each.key}'s tasks have been under 25% CPU for 15 minutes with nothing turned away: one task fewer, down to its min"
  evaluation_periods  = 15
  datapoints_to_alarm = 15
  threshold           = 25
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_appautoscaling_policy.scale_in[each.key].arn]

  metric_query {
    id          = "quiet"
    expression  = "cpu + 100 * busy"
    label       = "CPU, plus 100 for each request turned away"
    return_data = true
  }

  metric_query {
    id = "cpu"
    metric {
      namespace   = "AWS/ECS"
      metric_name = "CPUUtilization"
      dimensions  = { ClusterName = aws_ecs_cluster.main.name, ServiceName = aws_ecs_service.scaled[each.key].name }
      stat        = "Average"
      period      = 60
    }
  }

  metric_query {
    id = "busy"
    metric {
      namespace   = aws_cloudwatch_log_metric_filter.api_busy.metric_transformation[0].namespace
      metric_name = aws_cloudwatch_log_metric_filter.api_busy.metric_transformation[0].name
      stat        = "Sum"
      period      = 60
    }
  }
}
