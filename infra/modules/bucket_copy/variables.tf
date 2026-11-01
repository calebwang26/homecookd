variable "name" {
  description = "Names the copy's bucket (with the account id on the end), role and alarms"
  type        = string
}

variable "source_bucket" {
  description = "An existing bucket in the main region, with versioning on (S3 requires it)"
  type        = string
}

variable "old_version_days" {
  description = "How long the copy keeps a deleted or replaced file's bytes"
  type        = number
}

variable "current_days" {
  description = "Set when the source expires live files by age. S3 doesn't replicate that, so the copy needs the same rule. Null = none."
  type        = number
  default     = null
}

variable "storage_class" {
  type = string
}

variable "source_alert_topic_arn" {
  description = "SNS topic in the main region"
  type        = string
}

variable "copy_alert_topic_arn" {
  description = "SNS topic in the copy's region"
  type        = string
}
