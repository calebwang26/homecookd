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

# A Community report reaching a person, the same way: Apple reviews report and block, so one can't land silently. The api logs one line per report or block
# (api/src/modules/community/tasks.ts), with its kind, id and counts only. An email within minutes of the first.
resource "aws_cloudwatch_log_metric_filter" "community_report" {
  name           = "${local.name}-community-report"
  log_group_name = aws_cloudwatch_log_group.service["api"].name
  pattern        = "\"ALERT community report needs review\""
  metric_transformation {
    name      = "CommunityReport"
    namespace = "homecookd/${local.name}"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "community_report" {
  alarm_name          = "${local.name}-community-report"
  alarm_description   = "A Community report or block needs review. Run api/src/reports.ts open, then review <kind> <id> keep or remove, as a one-off task: docs/build/COMMUNITY-MIGRATION.md, The team's reports"
  namespace           = "homecookd/${local.name}"
  metric_name         = "CommunityReport"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# The daily reminder (community.remind_open, scheduled once a day) logs its line while any report is open past 12 hours. An hour's period sends one email for
# each day's run, even if the queue delivers it twice, and is back to OK long before the next. A day-long period could stay in alarm across days and email once.
resource "aws_cloudwatch_log_metric_filter" "community_reports_open" {
  name           = "${local.name}-community-reports-open"
  log_group_name = aws_cloudwatch_log_group.service["api"].name
  pattern        = "\"ALERT community reports still open\""
  metric_transformation {
    name      = "CommunityReportsOpen"
    namespace = "homecookd/${local.name}"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "community_reports_open" {
  alarm_name          = "${local.name}-community-reports-open"
  alarm_description   = "Community reports have been open for over 12 hours. Run api/src/reports.ts open, then review each, as a one-off task: docs/build/COMMUNITY-MIGRATION.md, The team's reports"
  namespace           = "homecookd/${local.name}"
  metric_name         = "CommunityReportsOpen"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# The load balancer's own errors, not the api's: no healthy task to send to, or one that didn't answer in time.
resource "aws_cloudwatch_metric_alarm" "alb_own_5xx" {
  alarm_name          = "${local.name}-alb-own-5xx"
  alarm_description   = "The load balancer itself is answering 502, 503 or 504: no healthy api task, or one too slow to answer"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_ELB_5XX_Count"
  dimensions          = { LoadBalancer = aws_lb.main.arn_suffix }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 10
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# Over the speed target (SYSTEM-DESIGN.md: p99 under 1 s at the load balancer) for 3 of the last 5 minutes.
resource "aws_cloudwatch_metric_alarm" "api_slow" {
  alarm_name          = "${local.name}-api-slow"
  alarm_description   = "The api's p99 at the load balancer is over 1 second"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  dimensions          = { LoadBalancer = aws_lb.main.arn_suffix }
  extended_statistic  = "p99"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = 1
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# The api's own work is what runs out first: the Nov 2 load test held one 0.25 vCPU task at 80% for 50 requests a second, with the database at 10%.
# The average over its tasks. When it autoscales to 50% (autoscaling.tf), 85% means it's at its most tasks and still hot, or new ones aren't starting.
resource "aws_cloudwatch_metric_alarm" "api_cpu" {
  alarm_name          = "${local.name}-api-cpu"
  alarm_description   = "The api's tasks are near their CPU limit, so requests are starting to queue"
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  dimensions          = { ClusterName = aws_ecs_cluster.main.name, ServiceName = local.ecs_services["api"].name }
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# Requests turned away because every database connection, or the row they wanted, was busy: a 503 with retry-after ("too busy to answer" in app.ts, and in
# the dish and invite routes' own handlers). A few in a burst is that working. More than this means the pool is too small or something holds rows (AWS-MIGRATION.md, "overload").
# The same count also adds an api task, minute by minute (autoscaling.tf, "shedding").
resource "aws_cloudwatch_log_metric_filter" "api_busy" {
  name           = "${local.name}-api-busy"
  log_group_name = aws_cloudwatch_log_group.service["api"].name
  pattern        = "\"too busy to answer\""
  metric_transformation {
    name      = "ApiTooBusy"
    namespace = "homecookd/${local.name}"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "api_busy" {
  alarm_name          = "${local.name}-api-busy"
  alarm_description   = "The api is turning requests away because the database is busy"
  namespace           = "homecookd/${local.name}"
  metric_name         = "ApiTooBusy"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 20
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# A scheduled message SQS handed out again (api/src/scheduled.ts, "scheduled message redelivered"): its last try failed, or the answer
# that carried it never reached the api, and it waited out the queue's 300 s visibility timeout. That's how a pending send came 5 minutes
# late on Nov 2. A lost answer shows as this line with no "a scheduled task failed" before it for the same outboxId.
resource "aws_cloudwatch_log_metric_filter" "scheduled_redelivered" {
  name           = "${local.name}-scheduled-redelivered"
  log_group_name = aws_cloudwatch_log_group.service["api"].name
  pattern        = "\"scheduled message redelivered\""
  metric_transformation {
    name      = "ScheduledRedelivered"
    namespace = "homecookd/${local.name}"
    value     = "1"
  }
}

# One now and then is SQS's at-least-once. A message is handed out 3 times at most, 5 minutes apart, so 5 in 15 minutes is several
# messages: tasks failing together, or receives losing their answers.
resource "aws_cloudwatch_metric_alarm" "scheduled_redelivered" {
  alarm_name          = "${local.name}-scheduled-redelivered"
  alarm_description   = "Scheduled messages keep being handed out again: tasks failing, or receives whose answer was lost, so pushes and sends run about 5 minutes late"
  namespace           = aws_cloudwatch_log_metric_filter.scheduled_redelivered.metric_transformation[0].namespace
  metric_name         = aws_cloudwatch_log_metric_filter.scheduled_redelivered.metric_transformation[0].name
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = 5
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

# With two tasks or more, one can be gone for good while the rest answer, and nothing above notices. A task replaced after a crash, or
# the swap in a deploy, is back within about 2 minutes, so this waits 5.
resource "aws_cloudwatch_metric_alarm" "service_below_floor" {
  for_each          = { for k, s in local.lb_services : k => s if s.autoscale != null && s.desired_count > 0 }
  alarm_name        = "${local.name}-${each.key}-below-floor"
  alarm_description = "${each.key} has had fewer than ${each.value.autoscale.min} healthy tasks for 5 minutes"
  namespace         = "AWS/ApplicationELB"
  metric_name       = "HealthyHostCount"
  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
    TargetGroup  = aws_lb_target_group.service[each.key].arn_suffix
  }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 5
  threshold           = each.value.autoscale.min
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"
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
