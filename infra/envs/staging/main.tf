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

variable "api_count" {
  description = "0 until the first api image is pushed"
  type        = number
  default     = 0
}

module "env" {
  source            = "../../modules/env"
  environment       = "staging"
  vpc_cidr          = "10.20.0.0/16"
  nat_gateways      = 1
  db_instance_class = "db.t4g.micro"
  db_multi_az       = false
  db_allocated_gb   = 20
  db_backup_days    = 7
  db_protected      = false
  alert_email       = "caleb.wang26@gmail.com"
  secret_names      = ["SENTRY_DSN_API", "SENTRY_DSN_WORKER"]

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
      secrets       = ["SENTRY_DSN_API"]
    }
    worker = {
      cpu           = 2048
      memory        = 8192
      desired_count = 0 # size and home (Fargate or EC2) follow a measured video job
      uses_database = true
      secrets       = ["SENTRY_DSN_WORKER"]
    }
  }
}

output "load_balancer_url" { value = module.env.load_balancer_url }
output "media_url" { value = module.env.media_url }
output "deploy_role_arn" { value = module.env.deploy_role_arn }
