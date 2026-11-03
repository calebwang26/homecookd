# terraform test, no AWS and no login. A Community report reaches a person on AWS (alerts.tf): the api's two log lines are counted, and each count alarms to the
# alerts topic, which emails alert_email. Apple reviews report and block, so these can't quietly come apart.
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
    defaults = { arn = "arn:aws:sns:us-west-2:123456789012:homecookd-test-alerts" }
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
    api = { cpu = 256, memory = 512, desired_count = 0, default_route = true, uses_database = true }
  }
}

run "a_report_emails_within_minutes" {
  command = apply

  assert {
    condition = (
      aws_cloudwatch_log_metric_filter.community_report.log_group_name == aws_cloudwatch_log_group.service["api"].name &&
      aws_cloudwatch_log_metric_filter.community_report.pattern == "\"ALERT community report needs review\""
    )
    error_message = "The filter counts the api's own line for a new report or block (api/src/modules/community/tasks.ts), in the api's log group."
  }

  assert {
    condition = (
      aws_cloudwatch_metric_alarm.community_report.namespace == aws_cloudwatch_log_metric_filter.community_report.metric_transformation[0].namespace &&
      aws_cloudwatch_metric_alarm.community_report.metric_name == aws_cloudwatch_log_metric_filter.community_report.metric_transformation[0].name &&
      aws_cloudwatch_log_metric_filter.community_report.metric_transformation[0].value == "1"
    )
    error_message = "The alarm watches the metric its filter writes, one for each line."
  }

  assert {
    condition = (
      aws_cloudwatch_metric_alarm.community_report.statistic == "Sum" &&
      aws_cloudwatch_metric_alarm.community_report.period == 300 &&
      aws_cloudwatch_metric_alarm.community_report.evaluation_periods == 1 &&
      aws_cloudwatch_metric_alarm.community_report.threshold == 1 &&
      aws_cloudwatch_metric_alarm.community_report.comparison_operator == "GreaterThanOrEqualToThreshold" &&
      aws_cloudwatch_metric_alarm.community_report.treat_missing_data == "notBreaching"
    )
    error_message = "One report in 5 minutes is enough to alarm, and a quiet log is OK, not missing data."
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.community_report.alarm_actions == toset([aws_sns_topic.alerts.arn])
    error_message = "The alarm goes to the alerts topic, the same email as every other alarm."
  }

  assert {
    condition     = strcontains(aws_cloudwatch_metric_alarm.community_report.alarm_description, "api/src/reports.ts open") && strcontains(aws_cloudwatch_metric_alarm.community_report.alarm_description, "COMMUNITY-MIGRATION.md")
    error_message = "The email says what to do: run the team's script, per its runbook."
  }
}

run "open_reports_email_each_day" {
  command = apply

  assert {
    condition = (
      aws_cloudwatch_log_metric_filter.community_reports_open.log_group_name == aws_cloudwatch_log_group.service["api"].name &&
      aws_cloudwatch_log_metric_filter.community_reports_open.pattern == "\"ALERT community reports still open\""
    )
    error_message = "The filter counts the daily reminder's own line, in the api's log group."
  }

  assert {
    condition = (
      aws_cloudwatch_metric_alarm.community_reports_open.namespace == aws_cloudwatch_log_metric_filter.community_reports_open.metric_transformation[0].namespace &&
      aws_cloudwatch_metric_alarm.community_reports_open.metric_name == aws_cloudwatch_log_metric_filter.community_reports_open.metric_transformation[0].name &&
      aws_cloudwatch_metric_alarm.community_reports_open.metric_name != aws_cloudwatch_metric_alarm.community_report.metric_name
    )
    error_message = "The reminder's alarm watches its own metric, not the new report's."
  }

  assert {
    condition = (
      aws_cloudwatch_metric_alarm.community_reports_open.statistic == "Sum" &&
      aws_cloudwatch_metric_alarm.community_reports_open.period * aws_cloudwatch_metric_alarm.community_reports_open.evaluation_periods < 86400 &&
      aws_cloudwatch_metric_alarm.community_reports_open.threshold == 1 &&
      aws_cloudwatch_metric_alarm.community_reports_open.comparison_operator == "GreaterThanOrEqualToThreshold" &&
      aws_cloudwatch_metric_alarm.community_reports_open.treat_missing_data == "notBreaching"
    )
    error_message = "Each day's reminder alarms, and the alarm is back to OK before the next day's, so every day sends an email."
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.community_reports_open.alarm_actions == toset([aws_sns_topic.alerts.arn])
    error_message = "The reminder goes to the alerts topic too."
  }

  assert {
    condition     = strcontains(aws_cloudwatch_metric_alarm.community_reports_open.alarm_description, "api/src/reports.ts open") && strcontains(aws_cloudwatch_metric_alarm.community_reports_open.alarm_description, "COMMUNITY-MIGRATION.md")
    error_message = "The reminder's email says what to do too."
  }

  assert {
    condition     = aws_sns_topic_subscription.email.topic_arn == aws_sns_topic.alerts.arn && aws_sns_topic_subscription.email.protocol == "email" && aws_sns_topic_subscription.email.endpoint == var.alert_email
    error_message = "The alerts topic emails alert_email."
  }
}
