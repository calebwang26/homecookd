# Phase 1: our own addresses in front of today's services. One CloudFront distribution per address, forwarding to origins
# passed in as variables. An empty map creates nothing. docs/build/ADDRESSES-MIGRATION.md explains the choices.
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

locals {
  files = { for k, a in var.addresses : k => a if a.files }
  # Routes can share an origin; a distribution lists each one once.
  origins = {
    for k, a in var.addresses : k => distinct(concat(
      [{ domain = a.origin_domain, path = a.origin_path }],
      [for r in a.routes : { domain = r.origin_domain, path = r.origin_path }],
    ))
  }
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

# Every viewer header, cookie and query string, including Authorization and the Sec-WebSocket-* headers. Not Host: Supabase,
# Convex and Cloud Run route on their own name.
data "aws_cloudfront_origin_request_policy" "all_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

data "aws_cloudfront_origin_request_policy" "cors" {
  name = "Managed-CORS-S3Origin"
}

# For files. ?v= is in the key, as publish.py expects, and any other query string is dropped. A file with no Cache-Control stays 1 hour. A week
# is the longest any stays, so a deleted file can't outlast the deletion promise here.
resource "aws_cloudfront_cache_policy" "files" {
  count       = length(local.files) > 0 ? 1 : 0
  name        = "${var.name}-files"
  min_ttl     = 0
  default_ttl = 3600
  max_ttl     = 604800
  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    cookies_config { cookie_behavior = "none" }
    headers_config { header_behavior = "none" }
    query_strings_config {
      query_string_behavior = "whitelist"
      query_strings { items = ["v"] }
    }
  }
}

# The same rule as cloud/media-cors.json, set here so a copy cached without an Origin still answers a browser.
resource "aws_cloudfront_response_headers_policy" "files" {
  count = length(local.files) > 0 ? 1 : 0
  name  = "${var.name}-files"
  cors_config {
    access_control_allow_credentials = false
    origin_override                  = true
    access_control_max_age_sec       = 3600
    access_control_allow_headers { items = ["*"] }
    access_control_allow_methods { items = ["GET", "HEAD", "OPTIONS"] }
    access_control_allow_origins { items = ["*"] }
    access_control_expose_headers { items = ["Content-Type", "Content-Range", "Accept-Ranges"] }
  }
}

# No access logs: URLs here carry session and family link tokens.
resource "aws_cloudfront_distribution" "address" {
  for_each        = var.addresses
  enabled         = true
  is_ipv6_enabled = true
  http_version    = each.value.files ? "http2and3" : "http2" # WebSockets always use HTTP/1.1, which clients ask for themselves
  comment         = "homecookd ${var.name} ${each.key}"
  price_class     = "PriceClass_200" # includes India, where many cooks are
  aliases         = each.value.domain == null ? [] : [each.value.domain]

  dynamic "origin" {
    for_each = local.origins[each.key]
    content {
      origin_id   = "${origin.value.domain}${origin.value.path}"
      domain_name = origin.value.domain
      origin_path = origin.value.path
      custom_origin_config {
        http_port                = 80
        https_port               = 443
        origin_protocol_policy   = each.value.origin_http_only ? "http-only" : "https-only"
        origin_ssl_protocols     = ["TLSv1.2"]
        origin_read_timeout      = 60 # CloudFront's most without a quota increase. A socket needs traffic at least this often
        origin_keepalive_timeout = 60
      }
    }
  }

  default_cache_behavior {
    target_origin_id           = "${each.value.origin_domain}${each.value.origin_path}"
    viewer_protocol_policy     = each.value.files ? "redirect-to-https" : "https-only" # a redirect would lose a POST's body
    allowed_methods            = each.value.files ? ["GET", "HEAD", "OPTIONS"] : ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = each.value.files
    cache_policy_id            = each.value.files ? aws_cloudfront_cache_policy.files[0].id : data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id   = each.value.files ? data.aws_cloudfront_origin_request_policy.cors.id : data.aws_cloudfront_origin_request_policy.all_except_host.id
    response_headers_policy_id = each.value.files ? aws_cloudfront_response_headers_policy.files[0].id : null
  }

  # Only for addresses that aren't files: the same pass-through as the default, to another origin.
  dynamic "ordered_cache_behavior" {
    for_each = each.value.routes
    content {
      path_pattern             = ordered_cache_behavior.value.path
      target_origin_id         = "${ordered_cache_behavior.value.origin_domain}${ordered_cache_behavior.value.origin_path}"
      viewer_protocol_policy   = "https-only"
      allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
      cached_methods           = ["GET", "HEAD"]
      compress                 = false
      cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
      origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_except_host.id
    }
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = each.value.certificate_arn == null
    acm_certificate_arn            = each.value.certificate_arn
    ssl_support_method             = each.value.certificate_arn == null ? null : "sni-only"
    minimum_protocol_version       = each.value.certificate_arn == null ? null : "TLSv1.2_2021"
  }

  lifecycle {
    precondition {
      condition     = each.value.domain == null || each.value.certificate_arn != null
      error_message = "A domain needs certificate_arn: an ACM certificate in us-east-1 that covers it."
    }
    precondition {
      condition     = !each.value.files || length(each.value.routes) == 0
      error_message = "A files address has no routes: everything on it is cached the same way."
    }
  }
}
