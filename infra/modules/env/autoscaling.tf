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
# A task is added a minute after the last one at the soonest, and taken away 5 minutes after: AWS also waits for 15 minutes under the
# target before it takes one away, so a lull between bursts doesn't cost a task that's needed again a minute later.
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
# doesn't need: the CPU policy above takes it away after 15 minutes under its target. This policy only adds.
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
