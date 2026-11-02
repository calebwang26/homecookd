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
  description = "Fargate services. path_patterns empty = no load balancer. secrets = names from secret_names. autoscale = CPU picks the count between min and max (autoscaling.tf)."
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
    entry_point   = optional(list(string))
    autoscale     = optional(object({ min = number, max = number }))
  }))
  validation {
    condition = alltrue([for s in values(var.services) : s.autoscale == null ? true : (
      s.autoscale.min >= 1 && s.autoscale.max >= s.autoscale.min && contains([0, s.autoscale.min], s.desired_count)
    )])
    error_message = "An autoscaled service needs min at least 1 and max no lower. Its desired_count is only the switch: 0 for off, or its min for on."
  }
  # The api turns on its test sign-in when it has this key (api/src/modules/accounts/testSignIn.ts). Scripts on staging need it; production never may.
  validation {
    condition     = var.environment != "production" || alltrue([for s in var.services : !contains(s.secrets, "TEST_SIGNIN_KEY") && !contains(keys(s.env), "TEST_SIGNIN_KEY")])
    error_message = "TEST_SIGNIN_KEY is staging's only: in production it would let anyone with the key sign in without Apple."
  }
}

variable "secret_names" {
  description = "Secrets Manager entries, names only. infra/scripts/load-secrets.sh fills them."
  type        = set(string)
  validation {
    condition     = var.environment != "production" || !contains(var.secret_names, "TEST_SIGNIN_KEY")
    error_message = "TEST_SIGNIN_KEY is staging's only: production has no test sign-in, so it has no key for one."
  }
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

variable "private_cors_origins" {
  description = "Sites that upload straight to the private bucket with presigned links"
  type        = list(string)
  default     = []
}

variable "schedules" {
  description = "EventBridge schedules into the scheduled queue: a cron or rate expression, and the task to run"
  type        = map(object({ expression = string, task = string }))
  default     = {}
}

variable "alb_allowed_cidrs" {
  description = "Who can reach the load balancer"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "alert_email" {
  type = string
}

variable "github_repository" {
  description = "owner/name. GitHub's job_workflow_ref claim uses the name, so renaming the repo stops the deploy login until this changes"
  type        = string
  default     = "calebwang26/homecookd"
}

variable "deploy_branch" {
  description = "The one branch whose workflows can log in to deploy. When aws-migration merges to main and goes away, staging's value changes with it"
  type        = string
  default     = "main"
}

variable "github_subject_prefix" {
  description = "This repo as GitHub's login names it, with its permanent ids: gh api repos/<repo>/actions/oidc/customization/sub"
  type        = string
  default     = "repo:calebwang26@292613801/homecookd@1431696591"
}

variable "db_iam_login" {
  description = "The api and worker log in as their own limited users with IAM tokens, not the master login. Off until each step in infra/README.md, \"Database logins\", is done"
  type        = bool
  default     = false
}
