# Sends one confirmation email when created; alerts start once the link in it is clicked.
resource "aws_sns_topic" "alerts" {
  name = "${local.name}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${local.name}-alb-5xx"
  alarm_description   = "The load balancer is returning server errors"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  dimensions          = { LoadBalancer = aws_lb.main.arn_suffix }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 20
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# The dish budget running out, from the api's own log line, to the same email as every other alarm. The api's REPORT_ALERT_URL (a secret-like webhook address) stays unset on AWS.
resource "aws_cloudwatch_log_metric_filter" "dish_budget" {
  name           = "${local.name}-dish-budget-reached"
  log_group_name = aws_cloudwatch_log_group.service["api"].name
  pattern        = "\"ALERT dish budget reached\""
  metric_transformation {
    name      = "DishBudgetReached"
    namespace = "homecookd/${local.name}"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "dish_budget" {
  alarm_name          = "${local.name}-dish-budget-reached"
  alarm_description   = "The dish ask reached its daily model budget: new cards are refused until tomorrow"
  namespace           = "homecookd/${local.name}"
  metric_name         = "DishBudgetReached"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "service_unhealthy" {
  for_each          = { for k, s in local.lb_services : k => s if s.desired_count > 0 }
  alarm_name        = "${local.name}-${each.key}-no-healthy-tasks"
  alarm_description = "${each.key} has no healthy tasks"
  namespace         = "AWS/ApplicationELB"
  metric_name       = "HealthyHostCount"
  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
    TargetGroup  = aws_lb_target_group.service[each.key].arn_suffix
  }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching" # a new service has no data yet; a real outage reports 0
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "db_cpu" {
  alarm_name          = "${local.name}-db-cpu"
  alarm_description   = "The database has been busy for 15 minutes"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "db_storage" {
  alarm_name          = "${local.name}-db-storage"
  alarm_description   = "The database has under 2 GB free"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 2147483648
  comparison_operator = "LessThanThreshold"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "dead_letters" {
  for_each = {
    jobs      = aws_sqs_queue.jobs_dead.name
    scheduled = aws_sqs_queue.scheduled_dead.name
  }
  alarm_name          = "${local.name}-${each.key}-dead-letters"
  alarm_description   = "A ${each.key} message failed 3 times"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = each.value }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# Work that's sitting: a consumer has stopped, or can't keep up. The outbox's own lateness goes to Sentry (api/src/index.ts).
resource "aws_cloudwatch_metric_alarm" "queue_age" {
  for_each = {
    jobs      = { name = aws_sqs_queue.jobs.name, seconds = 3600 }
    scheduled = { name = aws_sqs_queue.scheduled.name, seconds = 900 }
  }
  alarm_name          = "${local.name}-${each.key}-queue-age"
  alarm_description   = "The oldest ${each.key} message has waited over ${each.value.seconds} seconds"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  dimensions          = { QueueName = each.value.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = each.value.seconds
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
