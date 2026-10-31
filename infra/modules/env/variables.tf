variable "environment" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "nat_gateways" {
  description = "1 is cheaper; 2 keeps outbound calls working when one zone fails"
  type        = number
}

variable "db_instance_class" {
  type = string
}

variable "db_multi_az" {
  type = bool
}

variable "db_allocated_gb" {
  type = number
}

variable "db_backup_days" {
  description = "Restore to any point within this many days"
  type        = number
}

variable "db_protected" {
  description = "Deletion protection on, and a final snapshot if it is ever removed"
  type        = bool
}

variable "services" {
  description = "Fargate services. path_patterns empty = no load balancer. secrets = names from secret_names."
  type = map(object({
    cpu           = number
    memory        = number
    desired_count = number
    port          = optional(number, 8080)
    path_patterns = optional(list(string), [])
    default_route = optional(bool, false)
    drain_seconds = optional(number, 30)
    env           = optional(map(string), {})
    secrets       = optional(list(string), [])
    uses_database = optional(bool, false)
  }))
}

variable "secret_names" {
  description = "Secrets Manager entries, names only. infra/scripts/load-secrets.sh fills them."
  type        = set(string)
}

variable "certificate_arn" {
  description = "ACM certificate for the load balancer. Null = plain HTTP on the AWS address, until the domain moves (phase 1)."
  type        = string
  default     = null
}

variable "media_domain" {
  description = "media.homecookd.app or similar. Null = the CloudFront address."
  type        = string
  default     = null
}

variable "media_certificate_arn" {
  description = "ACM certificate in us-east-1, needed with media_domain"
  type        = string
  default     = null
}

variable "alert_email" {
  type = string
}

variable "github_subject_prefix" {
  description = "This repo as GitHub's login names it, with its permanent ids: gh api repos/<repo>/actions/oidc/customization/sub"
  type        = string
  default     = "repo:calebwang26@292613801/hackathon-homecookd@1431696591"
}
