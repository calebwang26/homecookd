# terraform test, no AWS and no login. The invariant sweep (invariants.tf): every invariant the api counts has a metric filter on its own line, staging pages nobody,
# and production alarms on each, plus on the sweep itself going quiet.
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

run "staging_counts_and_pages_nobody" {
  command = apply

  assert {
    condition     = length(aws_cloudwatch_log_metric_filter.invariant) == 9 && length(aws_cloudwatch_metric_alarm.invariant) == 0 && length(aws_cloudwatch_metric_alarm.invariants_ran) == 0
    error_message = "Eight invariants and the liveness line each get a filter; without invariant_alarms there are no alarms."
  }

  assert {
    condition = alltrue([for k, f in aws_cloudwatch_log_metric_filter.invariant :
      f.log_group_name == aws_cloudwatch_log_group.service["api"].name &&
      f.pattern == "{ ($.msg = \"invariant checked\") && ($.invariant = \"${k}\") }" &&
      f.metric_transformation[0].value == "$.count"
    ])
    error_message = "Each filter reads the api's own summary line for its invariant (api/src/modules/platform/invariants.ts), and its count is the metric."
  }
}

run "production_alarms_on_each_and_on_silence" {
  command = apply

  variables {
    invariant_alarms = true
  }

  assert {
    condition     = length(aws_cloudwatch_metric_alarm.invariant) == 8 && length(aws_cloudwatch_metric_alarm.invariants_ran) == 1
    error_message = "One alarm per invariant, and one on the sweep itself."
  }

  assert {
    condition = alltrue([for k, a in aws_cloudwatch_metric_alarm.invariant :
      a.metric_name == aws_cloudwatch_log_metric_filter.invariant[k].metric_transformation[0].name &&
      a.namespace == aws_cloudwatch_log_metric_filter.invariant[k].metric_transformation[0].namespace &&
      a.statistic == "Maximum" && a.period == 300 && a.threshold == 1 &&
      a.comparison_operator == "GreaterThanOrEqualToThreshold" && a.treat_missing_data == "notBreaching" &&
      a.alarm_actions == toset([aws_sns_topic.alerts.arn]) &&
      strcontains(a.alarm_description, "INVARIANT ${k}")
    ])
    error_message = "Each alarm watches its own filter's metric, one violating row in a run alarms, and the email says which log lines name the rows."
  }

  assert {
    condition = (
      aws_cloudwatch_metric_alarm.invariants_ran[0].metric_name == aws_cloudwatch_log_metric_filter.invariant["invariants_ran"].metric_transformation[0].name &&
      aws_cloudwatch_metric_alarm.invariants_ran[0].comparison_operator == "LessThanThreshold" &&
      aws_cloudwatch_metric_alarm.invariants_ran[0].treat_missing_data == "breaching" &&
      aws_cloudwatch_metric_alarm.invariants_ran[0].period == 900
    )
    error_message = "A sweep that stops running alarms within 15 minutes: missing data is breaching for this one."
  }
}
