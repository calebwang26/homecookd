variable "name" {
  description = "Prefix for this module's policies, unique in the account"
  type        = string
}

variable "addresses" {
  description = <<-EOT
    One distribution per entry. Empty creates nothing.
    origin_domain, origin_path: where it forwards. A host only; origin_path is put before every request's path.
    routes: other origins by path. CloudFront doesn't rewrite paths, so the path reaches that origin as it was asked for.
    files: cache it, for media. Otherwise nothing is cached and every method passes through.
    domain, certificate_arn: our own name, and an ACM certificate in us-east-1. Null: the cloudfront.net address.
    origin_http_only: for staging's load balancer, which has no certificate. Requests cross to it in the clear.
  EOT
  type = map(object({
    origin_domain    = string
    origin_path      = optional(string, "")
    origin_http_only = optional(bool, false)
    files            = optional(bool, false)
    domain           = optional(string)
    certificate_arn  = optional(string)
    routes = optional(list(object({
      path          = string
      origin_domain = string
      origin_path   = optional(string, "")
    })), [])
  }))
  default = {}

  validation {
    condition = alltrue(flatten([for a in var.addresses : [
      for d in concat([a.origin_domain], [for r in a.routes : r.origin_domain]) : can(regex("^[a-z0-9.-]+$", d))
    ]]))
    error_message = "origin_domain is a host name alone: no https://, no path."
  }
  validation {
    condition = alltrue(flatten([for a in var.addresses : [
      for p in concat([a.origin_path], [for r in a.routes : r.origin_path]) : p == "" || can(regex("^/.*[^/]$", p))
    ]]))
    error_message = "origin_path is empty, or starts with / and doesn't end with one."
  }
}
