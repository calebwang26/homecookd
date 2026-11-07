# Caleb's 99.9% picks (Nov 7, docs/agents/memory/uptime-first.md): 99.9% a month is about 43 minutes down. Each switch is one line here, then the same
# apply. Nov 8: Caleb turned on the standby database and the outside check and kept one NAT gateway (about $306 a month with the 4 vCPU worker;
# the second gateway can come in a later apply). Costs are us-west-2 list prices, and #381 has the whole list.
locals {
  # TODO(caleb): true = a standby database in the second zone. When the host or its zone dies, AWS fails over in 1 to 2 minutes, instead of being down
  # until that zone is back (10 to 30 minutes or more: most of a month's 43 in one event). About +$26 a month (the db.t4g.small and its 50 GB, twice).
  # The change runs in place, without a restart.
  db_multi_az = true
  # TODO(caleb): 2 = a NAT gateway in each zone. With one, losing its zone cuts the other zone's tasks off from Claude, Cartesia, Apple and Expo, so
  # recordings, sign-in revocation and pushes stop although the api still answers. About +$33 a month, plus data at $0.045 a GB.
  nat_gateways = 1
  # TODO(caleb): true = Route 53 calls https://api.homecookd.app/health from outside AWS every 30 s, and emails the alert address after 2 bad minutes.
  # Nothing outside AWS watches the api today: the alarms in modules/env see the load balancer from inside. About $3 a month. Its alarm and topic are in
  # us-east-1, the only region with Route 53's metrics, so it sends its own confirmation email to click once.
  uptime_check = true
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = { Project = "homecookd", Environment = "production", ManagedBy = "terraform" }
  }
}

# Healthy only when /health answers 2xx or 3xx over HTTPS within 4 s, from most of Route 53's checkers. 3 misses in a row is about 90 s.
resource "aws_route53_health_check" "api" {
  count             = local.uptime_check ? 1 : 0
  fqdn              = "api.homecookd.app"
  port              = 443
  type              = "HTTPS"
  resource_path     = "/health"
  request_interval  = 30
  failure_threshold = 3
  tags              = { Name = "homecookd-production-api" }
}

resource "aws_sns_topic" "uptime" {
  count    = local.uptime_check ? 1 : 0
  provider = aws.us_east_1
  name     = "homecookd-production-uptime"
}

resource "aws_sns_topic_subscription" "uptime_email" {
  count     = local.uptime_check ? 1 : 0
  provider  = aws.us_east_1
  topic_arn = aws_sns_topic.uptime[0].arn
  protocol  = "email"
  endpoint  = module.env.alert_email
}

# Down for 2 minutes running emails once, and again when it's back. No data counts as down: a check that stops reporting is no proof the api is up.
resource "aws_cloudwatch_metric_alarm" "api_down" {
  count               = local.uptime_check ? 1 : 0
  provider            = aws.us_east_1
  alarm_name          = "homecookd-production-api-down"
  alarm_description   = "https://api.homecookd.app/health has failed from outside AWS for 2 minutes"
  namespace           = "AWS/Route53"
  metric_name         = "HealthCheckStatus"
  dimensions          = { HealthCheckId = aws_route53_health_check.api[0].id }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.uptime[0].arn]
  ok_actions          = [aws_sns_topic.uptime[0].arn]
}
