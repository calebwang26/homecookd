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
  description = "0 turns the api off. 2 turns it on, and CPU then picks 2 to 4 tasks, as production will (infra/README.md, \"Autoscaling the api\")"
  type        = number
  default     = 2
}

variable "db_iam_login" {
  description = "The api and worker log in to Postgres as their own limited users with IAM tokens. Steps and the way back: infra/README.md, \"Database logins\""
  type        = bool
  default     = true
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
  # EDIBLE_CODE_KEY seals join, craving, dinner and share links (api/src/sealed.ts). Its value is Supabase's, loaded with load-secrets.sh, so copied rows open. A
  # name only goes on a service once its value is loaded: a secret with no value stops a task starting. TEST_SIGNIN_KEY turns on the api's test sign-in for
  # scripts (api/src/modules/accounts/testSignIn.ts) and its made-up recipe (recipes/testRecipe.ts); production refuses it. It's named on the api in the same
  # change because the merge's own deploy waits for an apply that refuses this (IAM), so nothing rolls out until Caleb has loaded its value (infra/README.md,
  # "The app on staging").
  secret_names = ["SENTRY_DSN_API", "SENTRY_DSN_WORKER", "RATE_LIMIT_SALT", "ANTHROPIC_API_KEY", "CARTESIA_API_KEY", "EDIBLE_CODE_KEY", "TEST_SIGNIN_KEY", "LINK_JOIN_SECRET", "LEFT_IDENTITY_SECRET"]

  alb_allowed_cidrs    = var.alb_allowed_cidrs
  private_cors_origins = [module.web.url, "http://localhost:3105"]
  db_iam_login         = var.db_iam_login
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
      autoscale     = { min = 2, max = 4 }
      drain_seconds = 90 # a task taken away finishes its requests first, and making a card can wait 60 s on the guess
      default_route = true
      uses_database = true
      # A secret with no value stops a task starting, so the real keys are named here only for a test window.
      secrets = concat(["SENTRY_DSN_API", "RATE_LIMIT_SALT", "EDIBLE_CODE_KEY", "TEST_SIGNIN_KEY", "LINK_JOIN_SECRET", "LEFT_IDENTITY_SECRET"], var.real_ai ? ["ANTHROPIC_API_KEY", "CARTESIA_API_KEY"] : [])
      env = merge(
        # OVERLOAD_SHED: overloaded, a request is turned away with a 503 and retry-after before any work (api/src/overload.ts). On here to test it; production decides with its size.
        { DISH_WEB_ORIGIN = module.web.url, DISH_DAILY_BUDGET_USD = var.dish_budget_usd, OVERLOAD_SHED = "on" },
        # Accounts owns staging's people and families: staging runs no sync, and 1.1 signs up and joins here (docs/build/contracts/ACCOUNTS.md,
        # "Staging testing"). Join links point at staging's own /i page. LINK_JOIN_SECRET and LEFT_IDENTITY_SECRET are staging's own random values.
        { ACCOUNTS_OWNS_PEOPLE = "1", EDIBLE_WEB_URL = module.web.url },
        # The api writes recipes: edits, share asks and story cards (api/src/modules/recipes/switch.ts). No sync runs here.
        { RECIPE_WRITES = "on" },
        # The app's web build, for testing screens in a browser against staging (api/src/cors.ts); Expo takes the next free port. Production sets none.
        { APP_WEB_ORIGINS = "http://localhost:8081,http://localhost:8082,http://localhost:8083" },
        # A video over 20 MiB goes up in parts, not over 5 GiB, so a small file tests them (api/src/modules/jobs/uploads.ts). Production may not set it (env module).
        { JOBS_SINGLE_PUT_MAX_BYTES = "20971520" },
        # Parts of 5 MiB, S3's smallest, not 64 MiB: a 25 MiB video comes back as 5 parts. Production may not set it either.
        { JOBS_PART_BYTES = "5242880" },
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
  source = "../../modules/front_door"
  name   = "homecookd-staging-front-door"
  # api: the app's HTTPS address for staging. iOS won't call plain HTTP, and the load balancer has no certificate, so CloudFront answers on its own
  # cloudfront.net name, with no DNS change, and passes every request through uncached. CloudFront to the load balancer is plain HTTP: staging holds no real
  # families. The api then sees CloudFront's address as the caller's, so its per-address limits count all callers together here (contracts/ACCOUNTS.md).
  addresses = merge({ api = { origin_domain = trimprefix(module.env.load_balancer_url, "http://"), origin_http_only = true } }, var.front_door)
}

output "load_balancer_url" { value = module.env.load_balancer_url }
output "media_url" { value = module.env.media_url }
output "deploy_role_arn" { value = module.env.deploy_role_arn }
output "web_url" { value = module.web.url }
output "web_bucket" { value = module.web.bucket }
output "web_distribution_id" { value = module.web.distribution_id }
output "front_door_domains" { value = module.front_door.cloudfront_domains }
