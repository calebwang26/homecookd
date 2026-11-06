# terraform test, no AWS and no login. A service's disk (disk_gib): unset is Fargate's 20 GiB with no ephemeral_storage block, so today's plans
# don't change, and a set size must be one Fargate allows, 21 to 200 GiB. The worker's video jobs are what may need more (docs/build/WORKER-MIGRATION.md).
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
}

run "unset_is_the_default_disk" {
  command = plan
  variables {
    services = {
      api    = { cpu = 256, memory = 512, desired_count = 0, default_route = true }
      worker = { cpu = 2048, memory = 8192, desired_count = 0 }
    }
  }

  assert {
    condition     = length(aws_ecs_task_definition.service["worker"].ephemeral_storage) == 0
    error_message = "Unset, the task definition has no ephemeral_storage block: Fargate's 20 GiB, and no change to today's plans."
  }
}

run "fifty_sets_fifty" {
  command = plan
  variables {
    services = {
      api    = { cpu = 256, memory = 512, desired_count = 0, default_route = true }
      worker = { cpu = 2048, memory = 8192, desired_count = 0, disk_gib = 50 }
    }
  }

  assert {
    condition     = one(aws_ecs_task_definition.service["worker"].ephemeral_storage).size_in_gib == 50
    error_message = "disk_gib = 50 gives the worker's task 50 GiB."
  }

  assert {
    condition     = length(aws_ecs_task_definition.service["api"].ephemeral_storage) == 0
    error_message = "Only the service that sets it gets a bigger disk."
  }
}

run "refuses_twenty" {
  command = plan
  variables {
    services = {
      api    = { cpu = 256, memory = 512, desired_count = 0, default_route = true }
      worker = { cpu = 2048, memory = 8192, desired_count = 0, disk_gib = 20 }
    }
  }
  expect_failures = [var.services]
}

run "refuses_two_hundred_and_one" {
  command = plan
  variables {
    services = {
      api    = { cpu = 256, memory = 512, desired_count = 0, default_route = true }
      worker = { cpu = 2048, memory = 8192, desired_count = 0, disk_gib = 201 }
    }
  }
  expect_failures = [var.services]
}

run "refuses_a_fraction" {
  command = plan
  variables {
    services = {
      api    = { cpu = 256, memory = 512, desired_count = 0, default_route = true }
      worker = { cpu = 2048, memory = 8192, desired_count = 0, disk_gib = 50.5 }
    }
  }
  expect_failures = [var.services]
}
