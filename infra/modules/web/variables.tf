variable "environment" {
  type = string
}

variable "deploy_role_name" {
  description = "The GitHub deploy role that gets permission to publish the site"
  type        = string
}

variable "domains" {
  description = "Addresses this site answers on. Empty = only the CloudFront address. Adding any is part of the DNS switch: Caleb's OK."
  type        = list(string)
  default     = []
}

variable "certificate_arn" {
  description = "ACM certificate in us-east-1, needed with domains"
  type        = string
  default     = null
}

variable "noindex" {
  description = "Tell search engines to skip this copy. True for anything that isn't homecookd.app."
  type        = bool
  default     = true
}
