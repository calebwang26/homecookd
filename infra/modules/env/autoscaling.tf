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

# Keeps the tasks' average CPU near 60%. A new task takes about 3 minutes to help: AWS waits for 3 minutes over the target, then Fargate
# starts it and the load balancer checks it twice. From 60%, traffic can grow by a third in that time before requests wait for CPU.
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
    target_value       = 60
    scale_out_cooldown = 60
    scale_in_cooldown  = 300
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
