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
  description = "Fargate services. path_patterns empty = no load balancer. secrets = names from secret_names. autoscale = CPU picks the count between min and max (autoscaling.tf). health_port = the load balancer checks /health there, not on port (the api's own thread, api/src/health.ts). disk_gib = the task's disk, unset = Fargate's 20 GiB."
  type = map(object({
    cpu           = number
    memory        = number
    desired_count = number
    port          = optional(number, 8080)
    health_port   = optional(number)
    path_patterns = optional(list(string), [])
    default_route = optional(bool, false)
    drain_seconds = optional(number, 30)
    env           = optional(map(string), {})
    secrets       = optional(list(string), [])
    uses_database = optional(bool, false)
    entry_point   = optional(list(string))
    autoscale     = optional(object({ min = number, max = number }))
    disk_gib      = optional(number)
  }))
  # Fargate's ephemeral storage: 21 to 200 GiB when set. Unset leaves the task definition with no ephemeral_storage block, at the free 20 GiB.
  validation {
    condition     = alltrue([for s in values(var.services) : s.disk_gib == null ? true : (s.disk_gib >= 21 && s.disk_gib <= 200 && floor(s.disk_gib) == s.disk_gib)])
    error_message = "disk_gib is a whole number from 21 to 200, as Fargate allows. Leave it unset for Fargate's default 20 GiB."
  }
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
  # Staging's small video parts, so a phone can test them with a small file (api/src/modules/jobs/uploads.ts partSettings). Production keeps 5 GiB and 64 MiB.
  validation {
    condition = var.environment != "production" || alltrue([for s in var.services : alltrue([
      for name in ["JOBS_SINGLE_PUT_MAX_BYTES", "JOBS_PART_BYTES"] : !contains(s.secrets, name) && !contains(keys(s.env), name)
    ])])
    error_message = "JOBS_SINGLE_PUT_MAX_BYTES and JOBS_PART_BYTES are staging's only: production's videos go up in one PUT to 5 GiB, then in 64 MiB parts."
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

variable "invariant_alarms" {
  description = "Alarms on the invariant sweep's metrics (invariants.tf). Production sets it; staging keeps the metrics and pages nobody"
  type        = bool
  default     = false
}

variable "github_repository" {
  description = "owner/name. GitHub's job_workflow_ref claim uses the name, so renaming the repo stops the deploy login until this changes"
  type        = string
  default     = "calebwang26/homecookd"
}

variable "deploy_branch" {
  description = "The one branch whose workflows can log in to deploy: main for both environments since aws-migration merged and retired (Nov 6)"
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
