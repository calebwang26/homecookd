# terraform test, no AWS and no login. Who gets the master database login (infra/README.md, "Database logins").
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
  services = {
    api    = { cpu = 256, memory = 512, desired_count = 0, default_route = true, uses_database = true, secrets = ["SENTRY_DSN_API"] }
    worker = { cpu = 1024, memory = 2048, desired_count = 0, uses_database = true }
    voice  = { cpu = 256, memory = 512, desired_count = 0, path_patterns = ["/cook*"] }
  }
}

run "master_login_until_switched" {
  command = apply

  assert {
    condition = alltrue([for k in ["api", "worker"] :
      contains([for s in jsondecode(aws_ecs_task_definition.service[k].container_definitions)[0].secrets : s.name], "DB_CREDENTIALS")
    ])
    error_message = "Until db_iam_login, the api and worker keep the master login, as today."
  }

  assert {
    condition     = !anytrue([for e in jsondecode(aws_ecs_task_definition.service["api"].container_definitions)[0].environment : contains(["DB_IAM", "DB_USER"], e.name)])
    error_message = "No IAM login settings before the switch."
  }

  assert {
    condition     = aws_db_instance.main.iam_database_authentication_enabled
    error_message = "IAM logins are on at the database first, so the switch has something to log in to."
  }
}

run "switched" {
  command = apply

  variables {
    db_iam_login = true
  }

  assert {
    condition = alltrue([for k in ["api", "worker"] :
      !strcontains(aws_ecs_task_definition.service[k].container_definitions, "DB_CREDENTIALS")
    ])
    error_message = "With db_iam_login, neither the api nor the worker is given the master login."
  }

  assert {
    condition = alltrue([for k, user in { api = "homecookd_api", worker = "homecookd_worker" } :
      contains(jsondecode(aws_ecs_task_definition.service[k].container_definitions)[0].environment, { name = "DB_USER", value = user })
      && contains(jsondecode(aws_ecs_task_definition.service[k].container_definitions)[0].environment, { name = "DB_IAM", value = "1" })
    ])
    error_message = "Each logs in as its own user, the one the migration makes."
  }

  assert {
    condition     = !strcontains(aws_iam_role_policy.execution_secrets["api"].policy, "rds!db") && !contains(keys(aws_iam_role_policy.execution_secrets), "worker")
    error_message = "Their execution roles can't fetch the master secret either."
  }

  assert {
    condition     = strcontains(aws_iam_role_policy.task["api"].policy, "dbuser:db-TESTONLY/homecookd_api") && !strcontains(aws_iam_role_policy.task["api"].policy, "homecookd_worker")
    error_message = "The api's role signs a token for its own user only."
  }

  assert {
    condition     = strcontains(aws_iam_role_policy.task["worker"].policy, "dbuser:db-TESTONLY/homecookd_worker") && !strcontains(aws_iam_role_policy.task["worker"].policy, "homecookd_api")
    error_message = "The worker's role signs a token for its own user only."
  }

  assert {
    condition     = !strcontains(aws_iam_role_policy.task["voice"].policy, "rds-db")
    error_message = "A service that doesn't use the database can't log in to it."
  }
}

run "migrations_keep_the_master_login" {
  command = apply

  variables {
    db_iam_login = true
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.migrate.container_definitions)[0].secrets[0].name == "DB_CREDENTIALS" && jsondecode(aws_ecs_task_definition.migrate.container_definitions)[0].command == ["node", "dist/migrate.js"]
    error_message = "The migrate task has the master login, and runs only the migrations."
  }

  assert {
    condition     = strcontains(aws_iam_role_policy.migrate_execution_secret.policy, "rds!db-test")
    error_message = "Its execution role reads the master secret."
  }

  assert {
    condition     = strcontains(aws_iam_role_policy.deploy.policy, "task-definition/homecookd-test-migrate:*") && !strcontains(aws_iam_role_policy.deploy.policy, "task-definition/homecookd-test-api:*")
    error_message = "A deploy runs the migrate task, and no longer an api task with a changed command."
  }
}
