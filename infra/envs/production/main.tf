# Production. NOT created yet: applying this needs Caleb's OK (likely over $300 a month). Nothing points at it until a
# phase in docs/build/AWS-MIGRATION.md moves traffic, which needs his OK again.
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    key          = "production/terraform.tfstate"
    region       = "us-west-2"
    use_lockfile = true
    # bucket comes from: terraform init -backend-config="bucket=homecookd-tfstate-<account id>"
  }
}

provider "aws" {
  region = "us-west-2"
  default_tags {
    tags = { Project = "homecookd", Environment = "production", ManagedBy = "terraform" }
  }
}

locals {
  voice_secrets  = ["CARTESIA_API_KEY", "CARTESIA_API_KEYS_BACKUP", "ANTHROPIC_API_KEY", "MOSS_PROJECT_ID", "MOSS_PROJECT_KEY", "VOICE_SECRET"]
  worker_secrets = ["ANTHROPIC_API_KEY", "CARTESIA_API_KEY", "CARTESIA_API_KEYS_BACKUP", "WORKER_SECRET"]
  api_secrets = [
    "ANTHROPIC_API_KEY", "APPLE_SIGNIN_KEY_ID", "APPLE_SIGNIN_PRIVATE_KEY", "APPLE_TEAM_ID", "CARTESIA_API_KEY",
    "DISH_IP_SALT", "EXPO_ACCESS_TOKEN", "LINK_JOIN_SECRET", "MOSS_PROJECT_ID", "MOSS_PROJECT_KEY",
    "REPORT_ALERT_TOKEN", "VOICE_SECRET", "WORKER_SECRET",
  ]
}

module "env" {
  source            = "../../modules/env"
  environment       = "production"
  vpc_cidr          = "10.30.0.0/16"
  nat_gateways      = 2
  db_instance_class = "db.t4g.medium"
  db_multi_az       = true
  db_allocated_gb   = 50
  db_backup_days    = 14
  db_protected      = true
  alert_email       = "caleb.wang26@gmail.com"
  secret_names      = toset(concat(local.voice_secrets, local.worker_secrets, local.api_secrets))
  # The api and worker never get the master login here: migrations run as their own task (infra/README.md, "Database logins").
  db_iam_login = true

  # TODO(caleb): certificate_arn, media_domain and media_certificate_arn need the DNS change in phase 1.

  services = {
    voice = {
      cpu           = 1024
      memory        = 2048
      desired_count = 0
      path_patterns = ["/cook*", "/record*", "/speak*", "/homie/*"]
      drain_seconds = 3600
      secrets       = local.voice_secrets
    }
    # Two small tasks, not one big one, so a task or a zone can fail without an outage. CPU adds up to two more when busy.
    api = {
      cpu           = 512
      memory        = 1024
      desired_count = 0 # launch: 2, its autoscale.min. Until then the range is 0 to 0 and nothing starts
      autoscale     = { min = 2, max = 4 }
      health_port   = 8081 # the load balancer's check, on its own thread (api/src/health.ts); the same as the image's HEALTH_PORT
      drain_seconds = 90   # a task taken away finishes its requests first, and making a card can wait 60 s on the guess
      default_route = true
      secrets       = local.api_secrets
      uses_database = true
      # The website's own pages, for the public routes they call from a browser: /r opens a share (api/src/cors.ts). No Vercel previews.
      env = { SITE_ORIGINS = "https://homecookd.app,https://www.homecookd.app" }
    }
    worker = {
      cpu           = 4096
      memory        = 16384
      desired_count = 0
      secrets       = local.worker_secrets
      uses_database = true
    }
  }
}

output "load_balancer_url" { value = module.env.load_balancer_url }
output "media_url" { value = module.env.media_url }
output "deploy_role_arn" { value = module.env.deploy_role_arn }
