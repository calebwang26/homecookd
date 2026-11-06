# Phase 1: api.homecookd.app, media.homecookd.app and a voice address, forwarding to today's services. Its own root, so it can
# exist before production does. Off until addresses are passed in. docs/build/ADDRESSES-MIGRATION.md has the steps, and they all
# need Caleb's OK: nothing here changes DNS. addresses.tfvars.example holds today's origins.
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    key          = "addresses/terraform.tfstate"
    region       = "us-west-2"
    use_lockfile = true
    # bucket comes from: terraform init -backend-config="bucket=homecookd-tfstate-<account id>"
  }
}

provider "aws" {
  region = "us-west-2"
  default_tags {
    tags = { Project = "homecookd", Environment = "addresses", ManagedBy = "terraform" }
  }
}

# CloudFront only takes certificates from this region.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = { Project = "homecookd", Environment = "addresses", ManagedBy = "terraform" }
  }
}

variable "addresses" {
  description = "Empty is off. The shape is in infra/modules/front_door/variables.tf. Once this is live, commit its values here as the default: a plain apply without them would remove the addresses."
  type        = any
  default     = {}
}

variable "certificate_domains" {
  description = "Asks ACM for one certificate covering these. Empty is off. It stays pending until Caleb adds the DNS records this root prints."
  type        = list(string)
  default     = []
}

module "front_door" {
  source    = "../modules/front_door"
  name      = "homecookd-addresses"
  addresses = var.addresses
}

resource "aws_acm_certificate" "addresses" {
  count                     = length(var.certificate_domains) > 0 ? 1 : 0
  provider                  = aws.us_east_1
  domain_name               = var.certificate_domains[0]
  subject_alternative_names = slice(var.certificate_domains, 1, length(var.certificate_domains))
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}

output "cloudfront_domains" {
  description = "What each address's CNAME points at"
  value       = module.front_door.cloudfront_domains
}

output "certificate_arn" {
  value = one(aws_acm_certificate.addresses[*].arn)
}

output "certificate_validation_records" {
  description = "Caleb adds these in DNS. Nothing here adds them."
  value = flatten([for c in aws_acm_certificate.addresses : [
    for o in c.domain_validation_options : { name = o.resource_record_name, type = o.resource_record_type, value = o.resource_record_value }
  ]])
}
