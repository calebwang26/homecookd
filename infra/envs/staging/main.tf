# Staging: the cheapest setup that still has every piece. It has no real keys and no real data: the voice service
# runs on its stub recipe with fake speech, so a stranger who finds the address can't spend credits or see a family.
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    key          = "staging/terraform.tfstate"
    region       = "us-west-2"
    use_lockfile = true
    # bucket comes from: terraform init -backend-config="bucket=homecookd-tfstate-<account id>"
  }
}

provider "aws" {
  region = "us-west-2"
  default_tags {
    tags = { Project = "homecookd", Environment = "staging", ManagedBy = "terraform" }
  }
}

variable "voice_count" {
  description = "0 until the first image is pushed (infra/README.md)"
  type        = number
  default     = 0
}

variable "real_ai" {
  description = "Real Claude and Cartesia, for a test window only: costs real money, capped by dish_budget_usd"
  type        = bool
  default     = false
}

variable "dish_budget_usd" {
  description = "The dish ask's daily model budget on staging. Mom's answers may pass it by MOM_OVERAGE_USD, and calls in flight by more (DISH-MIGRATION.md)"
  type        = string
  default     = "1"
}

variable "alb_allowed_cidrs" {
  description = "Set to one address (x.x.x.x/32) for a real_ai window. Open otherwise, for the deploy's smoke test"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "api_count" {
  type    = number
  default = 1
}

variable "front_door" {
  description = "Phase 1's addresses, to prove them on staging. Empty is off, and a plain apply removes them. Shape: infra/modules/front_door/variables.tf. Steps: docs/build/ADDRESSES-MIGRATION.md"
  type        = any
  default     = {}
  validation {
    condition     = !can(regex("grand-dragon-649|bsudybxsqvtwftsdmwmz|homecookd-voice-|edible-", jsonencode(var.front_door)))
    error_message = "Staging never forwards to a live service. Use a throwaway one."
  }
}

module "env" {
  source            = "../../modules/env"
  environment       = "staging"
  deploy_branch     = "aws-migration"
  vpc_cidr          = "10.20.0.0/16"
  nat_gateways      = 1
  db_instance_class = "db.t4g.micro"
  db_multi_az       = false
  db_allocated_gb   = 20
  db_backup_days    = 7
  db_protected      = false
  alert_email       = "caleb.wang26@gmail.com"
  secret_names      = ["SENTRY_DSN_API", "SENTRY_DSN_WORKER", "RATE_LIMIT_SALT", "ANTHROPIC_API_KEY", "CARTESIA_API_KEY"]

  alb_allowed_cidrs    = var.alb_allowed_cidrs
  private_cors_origins = [module.web.url, "http://localhost:3105"]
  schedules = {
    "dish.sweep"            = { expression = "rate(1 hour)", task = "dish.sweep" }
    "platform.prune"        = { expression = "rate(6 hours)", task = "platform.prune" }
    "jobs.sweep"            = { expression = "rate(1 hour)", task = "jobs.sweep" }
    "messages.hourly"       = { expression = "rate(1 hour)", task = "messages.hourly" }
    "messages.daily"        = { expression = "rate(1 day)", task = "messages.daily" }
    "community.remind_open" = { expression = "cron(0 16 * * ? *)", task = "community.remind_open" }
    "accounts.sweep"        = { expression = "rate(1 hour)", task = "accounts.sweep" }
  }

  services = {
    voice = {
      cpu           = 512
      memory        = 1024
      desired_count = var.voice_count
      path_patterns = ["/cook*", "/record*", "/speak*", "/homie/*"]
      drain_seconds = 3600
      env = {
        VOICE_STUB        = "1"
        VOICE_FAKE_SPEECH = "1"
        # voice/src/env.ts insists on these at start. Fake speech never calls Cartesia, and no real key is here.
        CARTESIA_API_KEY  = "staging-no-key"
        ANTHROPIC_API_KEY = "staging-no-key"
      }
    }
    api = {
      cpu           = 256
      memory        = 512
      desired_count = var.api_count
      default_route = true
      uses_database = true
      # A secret with no value stops a task starting, so the real keys are named here only for a test window.
      secrets = concat(["SENTRY_DSN_API", "RATE_LIMIT_SALT"], var.real_ai ? ["ANTHROPIC_API_KEY", "CARTESIA_API_KEY"] : [])
      env = merge(
        # OVERLOAD_SHED: overloaded, a request is turned away with a 503 and retry-after before any work (api/src/overload.ts). On here to test it; production decides with its size.
        { DISH_WEB_ORIGIN = module.web.url, DISH_DAILY_BUDGET_USD = var.dish_budget_usd, OVERLOAD_SHED = "on" },
        var.real_ai ? {} : { DISH_FAKE_AI = "1" },
      )
    }
    worker = {
      cpu           = 2048
      memory        = 8192
      desired_count = 0 # size and home (Fargate or EC2) follow a measured video job
      uses_database = true
      secrets       = ["SENTRY_DSN_WORKER"]
      # Queue mode (docs/build/WORKER-MIGRATION.md). No model keys here: a real run is a test window, with Caleb's OK.
      entry_point = ["python", "pipeline/queue_worker.py"]
    }
  }
}

# The website on S3 and CloudFront (phase 7). Nothing points at it: homecookd.app stays on Vercel until Caleb OKs the DNS.
module "web" {
  source           = "../../modules/web"
  environment      = "staging"
  deploy_role_name = module.env.deploy_role_name
}

module "front_door" {
  source    = "../../modules/front_door"
  name      = "homecookd-staging-front-door"
  addresses = var.front_door
}

output "load_balancer_url" { value = module.env.load_balancer_url }
output "media_url" { value = module.env.media_url }
output "deploy_role_arn" { value = module.env.deploy_role_arn }
output "web_url" { value = module.web.url }
output "web_bucket" { value = module.web.bucket }
output "web_distribution_id" { value = module.web.distribution_id }
output "front_door_domains" { value = module.front_door.cloudfront_domains }
