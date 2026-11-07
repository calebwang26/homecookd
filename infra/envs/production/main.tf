# Production. NOT created yet: applying it needs Caleb's OK (likely over $300 a month). Nothing public calls it until 1.1's release (docs/build/CUTOVER.md,
# step 10). It has every area's switch on from the start (CUTOVER.md, "What production has on at launch"), and every task at 0 until Caleb starts it.
# His steps, in order: infra/README.md, "Production before launch".
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

# HTTPS on api.homecookd.app and media.homecookd.app (CUTOVER.md, step 6). ACM issued both certificates on Nov 6 (their DNS checks are in Vercel, and stay
# there for renewals). Their ids are here, not their ARNs, so the account id stays out of the repo: the ARNs are built below from the account this applies
# to. Defaults, not -var: an apply without the -var would take HTTPS off again. Steps: infra/README.md, "Production before launch".
variable "api_certificate_id" {
  description = "ACM certificate for api.homecookd.app, in us-west-2, on the load balancer itself, so the api sees each caller's own address"
  type        = string
  default     = "a667dbe9-e9b5-498a-bf38-7478a6cc282a"
  validation {
    condition     = can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.api_certificate_id))
    error_message = "An ACM certificate id: the uuid at the end of its ARN."
  }
}

variable "media_domain" {
  description = "media.homecookd.app, on the media CloudFront. MEDIA_BASE_URL follows it"
  type        = string
  default     = "media.homecookd.app"
}

variable "media_certificate_id" {
  description = "ACM certificate for media_domain, in us-east-1: CloudFront takes no other region's"
  type        = string
  default     = "75afb58a-bd1b-4da1-94aa-84bb7c6060c1"
  validation {
    condition     = can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.media_certificate_id))
    error_message = "An ACM certificate id: the uuid at the end of its ARN."
  }
}

data "aws_caller_identity" "current" {}

locals {
  # The switch (#295): 0 until Caleb starts production in CUTOVER.md's step 6, then 2, the api's autoscale.min. One line, by PR, then his apply. A local, not a
  # variable, so no later apply can turn production off by leaving out a -var. It starts the schedules too: only the api reads the scheduled queue
  # (api/src/scheduled.ts), so with no api they'd sit for SQS's 4 days, set off the queue-age alarm, and all run at once when it starts.
  api_count = 2

  # Staging's rates, but jobs.sweep runs every 5 minutes, as JOBS-MIGRATION.md says. It's how a job finds its upload when the phone never said it finished
  # (the old worker re-queued every 30 s), so hourly could leave a cook's video waiting up to an hour. Staging's stays hourly.
  schedules = {
    "dish.sweep"            = { expression = "rate(1 hour)", task = "dish.sweep" }
    "platform.prune"        = { expression = "rate(6 hours)", task = "platform.prune" }
    "jobs.sweep"            = { expression = "rate(5 minutes)", task = "jobs.sweep" }
    "messages.hourly"       = { expression = "rate(1 hour)", task = "messages.hourly" }
    "messages.daily"        = { expression = "rate(1 day)", task = "messages.daily" }
    "community.remind_open" = { expression = "cron(0 16 * * ? *)", task = "community.remind_open" }
    "accounts.sweep"        = { expression = "rate(1 hour)", task = "accounts.sweep" }
  }

  # Names only. Where each value comes from, and why the four link secrets are production's own: infra/README.md, "Production before launch". A secret
  # with no value stops a task starting, so each is filled before the first deploy. Never here: TEST_SIGNIN_KEY (the env module refuses it), DISH_IP_SALT
  # (nothing reads it; the api's limits use RATE_LIMIT_SALT), VOICE_SECRET and WORKER_SECRET (Convex's, for Cloud Run voice and the laptop worker), and
  # REPORT_ALERT_TOKEN (used only beside REPORT_ALERT_URL, which stays unset on AWS: alarms email instead).
  api_secrets = [
    "ANTHROPIC_API_KEY", "CARTESIA_API_KEY", "CARTESIA_API_KEYS_BACKUP", "SENTRY_DSN_API",
    "RATE_LIMIT_SALT", "EDIBLE_CODE_KEY", "LINK_JOIN_SECRET", "LEFT_IDENTITY_SECRET",
    # Sign in with Apple's revocation before a delete (App Review 5.1.1(v), api/src/modules/accounts/appleRevoke.ts). Loaded Nov 6 from Salik's key
    # S3J2G3P3H3 (the same key carries the APNs push on Expo); on the task since then. Convex never had this key, so its deletes went unrevoked.
    "APPLE_TEAM_ID", "APPLE_SIGNIN_KEY_ID", "APPLE_SIGNIN_PRIVATE_KEY",
  ]
  # Named, but not on the api's task until a value exists, since an empty one stops the task starting. Expo's push token is optional (pushes go
  # without one; Caleb, Nov 6: skipped on purpose, it would be a token on Salik's Expo account). TODO(caleb): if one is ever loaded (infra/README.md
  # step 5), move it into api_secrets by PR, and apply.
  api_secrets_later = ["EXPO_ACCESS_TOKEN"]
  worker_secrets    = ["ANTHROPIC_API_KEY", "CARTESIA_API_KEY", "CARTESIA_API_KEYS_BACKUP", "SENTRY_DSN_WORKER"]
  # Caleb, Nov 2 (CUTOVER.md, open question 7): production sends nothing to Moss, and the key names stay. No service here reads them, so they stay empty.
  moss_names = ["MOSS_PROJECT_ID", "MOSS_PROJECT_KEY"]
}

module "env" {
  source      = "../../modules/env"
  environment = "production"
  vpc_cidr    = "10.30.0.0/16"
  # Lean at launch (Caleb, Nov 5): one NAT gateway and a db.t4g.small in one zone, about $95 a month before any task runs. A zone outage stops outbound
  # calls and the database until that zone is back; nothing is lost (backups below). The full setup, about $210, is these three lines, by PR, with no
  # data loss: nat_gateways = 2, db_instance_class = "db.t4g.medium", db_multi_az = true. Multi-AZ's change runs in place; the instance class change
  # restarts the database for a few minutes, so do it in a quiet hour. Since Nov 7 the NAT count and Multi-AZ are switches in uptime.tf, with their costs.
  nat_gateways      = local.nat_gateways
  db_instance_class = "db.t4g.small"
  db_multi_az       = local.db_multi_az
  db_allocated_gb   = 50
  db_backup_days    = 14
  db_protected      = true
  # Every alarm emails this, once the link in AWS's confirmation email is clicked.
  alert_email  = "caleb.wang26@gmail.com"
  secret_names = toset(concat(local.api_secrets, local.api_secrets_later, local.worker_secrets, local.moss_names))
  # The api and worker never get the master login here: migrations run as their own task (infra/README.md, "Database logins").
  db_iam_login = true

  # The regions are fixed here: the load balancer's is us-west-2, and CloudFront takes only us-east-1's.
  certificate_arn       = "arn:aws:acm:us-west-2:${data.aws_caller_identity.current.account_id}:certificate/${var.api_certificate_id}"
  media_domain          = var.media_domain
  media_certificate_arn = "arn:aws:acm:us-east-1:${data.aws_caller_identity.current.account_id}:certificate/${var.media_certificate_id}"

  # The site's pages PUT voice notes and photos to the private bucket with presigned links (DISH-MIGRATION.md). localhost:3105 is the site built locally
  # against production in CUTOVER.md's step 8, as the api allows localhost (DISH-MIGRATION.md's TODO(caleb) would close both). No app web build here.
  private_cors_origins = ["https://homecookd.app", "https://www.homecookd.app", "http://localhost:3105"]

  schedules = { for name, s in local.schedules : name => s if local.api_count > 0 }

  # No voice service: homie is off in 1.1 (HOMIE_ON = false), so 1.1 calls no voice address, and voice/ still reads its recipes and sessions from Convex and
  # holds no task protection yet (AWS-MIGRATION.md, phase 3). Defined at 0 it would only add its four paths to api.homecookd.app, answering 503. When homie
  # returns, it comes back as one entry here, with the size staging runs.
  services = {
    # Two small tasks, not one big one, so a task or a zone can fail without an outage. CPU adds up to two more when busy.
    api = {
      cpu           = 512
      memory        = 1024
      desired_count = local.api_count
      autoscale     = { min = 2, max = 4 }
      health_port   = 8081 # the load balancer's check, on its own thread (api/src/health.ts); the same as the image's HEALTH_PORT
      drain_seconds = 90   # a task taken away finishes its requests first, and making a card can wait 60 s on the guess
      default_route = true
      secrets       = local.api_secrets
      uses_database = true
      # MEDIA_BASE_URL comes from the env module: the media CloudFront, then media_domain. Unset on purpose: APP_WEB_ORIGINS, SYNC_MODE, LIVE_OFF and
      # DISH_FAKE_AI (CUTOVER.md, "Never in production"), DISH_DAILY_BUDGET_USD (the code's $10, its own TODO(caleb)), and GOOGLE_CLIENT_IDS, until Caleb's
      # Google clients exist (contracts/ACCOUNTS.md, open item 8). TODO(caleb): APPLE_AUDIENCES keeps its default, which still takes Expo Go's tokens (item 11).
      env = {
        # Accounts owns production's people and families from the first sign-up: no sync runs (contracts/ACCOUNTS.md).
        ACCOUNTS_OWNS_PEOPLE = "1"
        # The api writes recipes: edits, share asks, story cards and a new job's "processing" card (api/src/modules/recipes/switch.ts; JOBS.md, open item 14).
        RECIPE_WRITES = "on"
        # Join links and the kid's pages point at the site. Both are also the code's defaults; set here so production doesn't lean on them.
        EDIBLE_WEB_URL  = "https://homecookd.app"
        DISH_WEB_ORIGIN = "https://homecookd.app"
        # The website's own pages, for the public routes they call from a browser: /r opens a share (api/src/cors.ts). No Vercel previews.
        SITE_ORIGINS = "https://homecookd.app,https://www.homecookd.app"
        # Overloaded, a request gets a fast 503 with retry-after before any work (api/src/overload.ts), and the shedding policy counts those lines to add a
        # task within a minute (modules/env/autoscaling.tf). Off, a busy task queues requests for seconds (13 s on staging's test), and only CPU grows it.
        OVERLOAD_SHED = "on"
      }
    }
    # Queue mode (docs/build/WORKER-MIGRATION.md), every step on Claude and Cartesia, as the laptop's worker runs: production has no Gemini or Muse key.
    # The spend caps are the code's, Caleb's $12 a job and $30 a day (PIPELINE_JOB_CAP_USD, PIPELINE_DAILY_CAP_USD). TODO(caleb): the size, Fargate or
    # EC2, and a bigger disk, from the real video job CUTOVER.md's step 6 measures. Until then it's the size that job is measured at.
    # One task always on: nothing else claims a cook's video, and the service has no autoscaler, so at 0 every job sat in the queue (Nov 7, the TEST
    # family's Biryani). At this size it's about $85 a month (2 vCPU and 8 GB for 730 hours). TODO(caleb): one always on, or 0 to 1 on the queue's
    # depth (about $4 to $35 a month for 1 to 10 videos a day, and a cook's first video waits about 2 to 4 minutes for a task: #377).
    worker = {
      # TODO(caleb): disk_gib (21 to 200) once the measured job's disk_peak_mb says 20 GiB isn't enough. Unset is Fargate's 20 GiB.
      cpu           = 2048
      memory        = 8192
      desired_count = 1
      uses_database = true
      secrets       = local.worker_secrets
      entry_point   = ["python", "pipeline/queue_worker.py"]
      env = {
        EXTRACTOR            = "claude"
        TEXT_PROVIDER        = "claude"
        COVER_PROVIDER       = "claude"
        ALIGN_PROVIDER       = "claude"
        RECIPE_WRITER        = "claude"
        TRANSCRIPT_PROOFREAD = "claude"
      }
    }
  }
}

output "load_balancer_url" { value = module.env.load_balancer_url }
output "media_url" { value = module.env.media_url }
output "deploy_role_arn" { value = module.env.deploy_role_arn }
# What Caleb's two CNAMEs point at (infra/README.md, "Production before launch"). media_url shows media_domain once it's set, so this keeps CloudFront's own name.
output "dns_targets" { value = { api = module.env.load_balancer_dns, media = module.env.media_cloudfront_domain } }
