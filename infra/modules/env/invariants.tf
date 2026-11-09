# The api's invariant sweep (api/src/modules/platform/invariants.ts, the platform.invariants schedule, every 5 minutes) logs one "invariant checked" line per
# invariant and run with its count, even at 0. Each becomes a metric here, and with invariant_alarms an alarm to the alerts topic at 1 or more. The violating
# rows' ids are in the api log as "INVARIANT <name>" lines. The keys are INVARIANTS' names there: change both together.
locals {
  invariants = {
    job_queued_no_wakeup    = { metric = "InvariantJobQueuedNoWakeup", look = "A job has been queued for 3 hours with no wake-up owed: the worker's own re-wake didn't take" }
    job_running_stale       = { metric = "InvariantJobRunningStale", look = "A running job's heartbeat stopped 15 minutes ago and nothing has taken it back" }
    push_queued_stale       = { metric = "InvariantPushQueuedStale", look = "A push has been queued an hour past its send time, or sending for an hour: push.sweep isn't moving it" }
    dish_merge_stuck        = { metric = "InvariantDishMergeStuck", look = "A dish ask has been merging Mom's answers for over 10 minutes" }
    deletion_stalled        = { metric = "InvariantDeletionStalled", look = "An account deletion stalled for an hour, or its purge outside the database gave up" }
    outbox_stuck            = { metric = "InvariantOutboxStuck", look = "An outbox row failed to send 5 times or more" }
    recipe_shared_not_ready = { metric = "InvariantRecipeSharedNotReady", look = "A recipe that isn't ready is shared or hidden on Community" }
    dinner_full_with_seats  = { metric = "InvariantDinnerFullWithSeats", look = "A dinner says full with seats left" }
  }
  invariant_filters = merge(local.invariants, { invariants_ran = { metric = "InvariantsRan", look = "" } })
}

resource "aws_cloudwatch_log_metric_filter" "invariant" {
  for_each       = local.invariant_filters
  name           = "${local.name}-invariant-${replace(each.key, "_", "-")}"
  log_group_name = aws_cloudwatch_log_group.service["api"].name
  pattern        = "{ ($.msg = \"invariant checked\") && ($.invariant = \"${each.key}\") }"
  metric_transformation {
    name      = each.value.metric
    namespace = "homecookd/${local.name}"
    value     = "$.count"
  }
}

# Any violating row in a 5-minute run alarms; each invariant's own SQL already waits out the normal delay, so one run is enough.
resource "aws_cloudwatch_metric_alarm" "invariant" {
  for_each            = var.invariant_alarms ? local.invariants : {}
  alarm_name          = "${local.name}-invariant-${replace(each.key, "_", "-")}"
  alarm_description   = "${each.value.look}. The row ids are the api log's \"INVARIANT ${each.key}\" lines. Owner: AWS backend (docs/agents/STATE-MACHINES.md)"
  namespace           = "homecookd/${local.name}"
  metric_name         = each.value.metric
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# The sweep itself: no run in 15 minutes (the api down, the schedule gone, the task failing) alarms too. Missing data is breaching here, unlike above.
resource "aws_cloudwatch_metric_alarm" "invariants_ran" {
  count               = var.invariant_alarms ? 1 : 0
  alarm_name          = "${local.name}-invariants-ran"
  alarm_description   = "The invariant sweep (platform.invariants) hasn't run for 15 minutes, so the other invariant alarms can't see anything. Look at the api's scheduled queue"
  namespace           = "homecookd/${local.name}"
  metric_name         = "InvariantsRan"
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
