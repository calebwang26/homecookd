# terraform test, no AWS and no login. Production can never hold TEST_SIGNIN_KEY, the key that turns on the api's test sign-in (api/src/modules/accounts/testSignIn.ts).
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
  vpc_cidr          = "10.9.0.0/16"
  nat_gateways      = 1
  db_instance_class = "db.t4g.micro"
  db_multi_az       = false
  db_allocated_gb   = 20
  db_backup_days    = 1
  db_protected      = false
  alert_email       = "alerts@example.com"
}

run "staging_may_have_it" {
  command = plan
  variables {
    environment  = "staging"
    secret_names = ["SENTRY_DSN_API", "TEST_SIGNIN_KEY"]
    services = {
      api = { cpu = 256, memory = 512, desired_count = 0, default_route = true, secrets = ["SENTRY_DSN_API", "TEST_SIGNIN_KEY"] }
    }
  }
}

run "production_refuses_the_secret_name" {
  command = plan
  variables {
    environment  = "production"
    secret_names = ["SENTRY_DSN_API", "TEST_SIGNIN_KEY"]
    services = {
      api = { cpu = 256, memory = 512, desired_count = 0, default_route = true, secrets = ["SENTRY_DSN_API"] }
    }
  }
  expect_failures = [var.secret_names]
}

run "production_refuses_it_on_a_service" {
  command = plan
  variables {
    environment  = "production"
    secret_names = ["SENTRY_DSN_API"]
    services = {
      api = { cpu = 256, memory = 512, desired_count = 0, default_route = true, secrets = ["SENTRY_DSN_API", "TEST_SIGNIN_KEY"] }
    }
  }
  expect_failures = [var.services]
}

run "production_refuses_it_as_plain_env" {
  command = plan
  variables {
    environment  = "production"
    secret_names = ["SENTRY_DSN_API"]
    services = {
      api = { cpu = 256, memory = 512, desired_count = 0, default_route = true, env = { TEST_SIGNIN_KEY = "anything" } }
    }
  }
  expect_failures = [var.services]
}
