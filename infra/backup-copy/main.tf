# Step 8 of docs/build/AWS-MIGRATION.md: a copy of the backups and files in a second region. Everything here is off until a
# variable names it, because it costs money. docs/build/REGION-COPY.md has what it protects, its cost, and how deletions reach it.
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    key          = "backup-copy/terraform.tfstate"
    region       = "us-west-2"
    use_lockfile = true
    # bucket comes from: terraform init -backend-config="bucket=homecookd-tfstate-<account id>"
  }
}

provider "aws" {
  region = "us-west-2"
  default_tags {
    tags = { Project = "homecookd", Environment = "backup-copy", ManagedBy = "terraform" }
  }
}

provider "aws" {
  alias  = "copy"
  region = var.copy_region
  default_tags {
    tags = { Project = "homecookd", Environment = "backup-copy", ManagedBy = "terraform" }
  }
}

variable "source_environments" {
  description = "Which environments to copy. Empty is off. It costs money and holds what the environment holds, so staging only for a short drill; production needs Caleb's OK."
  type        = set(string)
  default     = []
  validation {
    condition     = alltrue([for e in var.source_environments : contains(["staging", "production"], e)])
    error_message = "Only staging or production."
  }
}

variable "copy_convex_backups" {
  description = "Copy the Convex backups bucket (infra/backups). It holds real family data, so /privacy has to list AWS first."
  type        = bool
  default     = false
}

variable "copy_region" {
  type    = string
  default = "us-east-1"
  validation {
    condition     = var.copy_region != "us-west-2"
    error_message = "The copy has to be in a different region from us-west-2."
  }
}

variable "db_copy_days" {
  description = "How long the copy keeps database backups. 28 at most, inside /privacy's 30 more days."
  type        = number
  default     = 7
  validation {
    condition     = var.db_copy_days >= 1 && var.db_copy_days <= 28
    error_message = "Between 1 and 28 days: /privacy says deleted data leaves backups within 30."
  }
}

variable "old_version_days" {
  description = "How long the copy keeps a deleted or replaced file's bytes. 28 at most, as on the source. Less than the source's, so a late delete marker still lands inside the promise."
  type        = number
  default     = 21
  validation {
    condition     = var.old_version_days >= 1 && var.old_version_days <= 28
    error_message = "Between 1 and 28 days: /privacy says deleted data leaves backups within 30."
  }
}

variable "uploads_expire_days" {
  description = "Set this if the source uploads bucket gets an age rule (AWS-MIGRATION, how long raw footage is kept). S3 doesn't replicate lifecycle deletes, so the copy needs the same number."
  type        = number
  default     = null
}

variable "storage_class" {
  description = "For the files in the copy. Read only in a disaster, and Standard-IA is about half of Standard's price."
  type        = string
  default     = "STANDARD_IA"
}

variable "alert_email" {
  type    = string
  default = "caleb.wang26@gmail.com"
}

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  on         = length(var.source_environments) > 0 || var.copy_convex_backups

  buckets = merge(
    {
      for pair in setproduct(var.source_environments, ["media", "uploads", "private"]) : "${pair[0]}-${pair[1]}" => {
        name             = "homecookd-${pair[0]}-${pair[1]}-copy"
        source           = "homecookd-${pair[0]}-${pair[1]}-${local.account_id}"
        old_version_days = var.old_version_days
        current_days     = pair[1] == "uploads" ? var.uploads_expire_days : null
      }
    },
    # The same 21 + 7 days as infra/backups.
    var.copy_convex_backups ? {
      convex-backups = {
        name             = "homecookd-backups-copy"
        source           = "homecookd-backups-${local.account_id}"
        old_version_days = 7
        current_days     = 21
      }
    } : {},
  )
}

# An alarm has to name a topic in its own region. Each subscription sends one confirmation email, and alerts start once it's clicked.
resource "aws_sns_topic" "source_alerts" {
  count = local.on ? 1 : 0
  name  = "homecookd-backup-copy-alerts"
}

resource "aws_sns_topic_subscription" "source_email" {
  count     = local.on ? 1 : 0
  topic_arn = aws_sns_topic.source_alerts[0].arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_sns_topic" "copy_alerts" {
  count    = local.on ? 1 : 0
  provider = aws.copy
  name     = "homecookd-backup-copy-alerts"
}

resource "aws_sns_topic_subscription" "copy_email" {
  count     = local.on ? 1 : 0
  provider  = aws.copy
  topic_arn = aws_sns_topic.copy_alerts[0].arn
  protocol  = "email"
  endpoint  = var.alert_email
}

module "bucket" {
  for_each = local.buckets
  source   = "../modules/bucket_copy"
  providers = {
    aws      = aws
    aws.copy = aws.copy
  }
  name                   = each.value.name
  source_bucket          = each.value.source
  old_version_days       = each.value.old_version_days
  current_days           = each.value.current_days
  storage_class          = var.storage_class
  source_alert_topic_arn = aws_sns_topic.source_alerts[0].arn
  copy_alert_topic_arn   = aws_sns_topic.copy_alerts[0].arn
}

# The database. Encrypted backups need a key in the copy's region. Deleting this key makes the copied backups unreadable.
resource "aws_kms_key" "db_copy" {
  count                   = length(var.source_environments) > 0 ? 1 : 0
  provider                = aws.copy
  description             = "homecookd: database backups copied from us-west-2"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "db_copy" {
  count         = length(var.source_environments) > 0 ? 1 : 0
  provider      = aws.copy
  name          = "alias/homecookd-db-copy"
  target_key_id = aws_kms_key.db_copy[0].key_id
}

data "aws_db_instance" "source" {
  for_each               = var.source_environments
  db_instance_identifier = "homecookd-${each.key}"
}

# Called in the copy's region, as RDS requires. Snapshots and transaction logs follow as they're made.
resource "aws_db_instance_automated_backups_replication" "db" {
  for_each               = var.source_environments
  provider               = aws.copy
  source_db_instance_arn = data.aws_db_instance.source[each.key].db_instance_arn
  retention_period       = var.db_copy_days
  kms_key_id             = aws_kms_key.db_copy[0].arn
}

output "copy_buckets" {
  value = { for k, m in module.bucket : k => m.bucket }
}
