# The website (web/, a static export) on S3 behind CloudFront. docs/build/WEB-MIGRATION.md explains the choices.
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

data "aws_caller_identity" "current" {}

locals {
  name = "homecookd-${var.environment}-web"

  # edge_ttl: how long CloudFront keeps a file (S3 objects carry no Cache-Control, so this decides). headers: what the
  # browser is told, the same values as Vercel's defaults and web/vercel.json.
  classes = {
    page = {
      edge_ttl = 300
      headers  = { "Cache-Control" = "public, max-age=0, must-revalidate" }
    }
    immutable = {
      edge_ttl = 31536000
      headers  = { "Cache-Control" = "public, max-age=31536000, immutable" }
    }
    media = {
      edge_ttl = 3600
      headers  = { "Cache-Control" = "public, max-age=3600, stale-while-revalidate=604800" }
    }
    aasa = {
      edge_ttl = 300
      headers = {
        "Cache-Control" = "public, max-age=3600"
        "Content-Type"  = "application/json"
      }
    }
  }

  # In order, first match wins; everything else is the default behavior, class "page".
  behaviors = [
    # Universal links on every installed phone depend on this path, so it runs no code, whatever the function does.
    { path = "/.well-known/apple-app-site-association", class = "aasa", rewrite = false, compress = false },
    { path = "/fonts/*", class = "immutable", rewrite = true, compress = false },
    { path = "/_next/static/*", class = "immutable", rewrite = true, compress = true },
    { path = "/media/*", class = "media", rewrite = true, compress = true },
  ]
}

resource "aws_s3_bucket" "web" {
  bucket = "${local.name}-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = local.name
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "rewrite" {
  name    = "${local.name}-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "Clean URLs, trailing slashes and 404s, as Vercel does them"
  publish = true
  code    = file("${path.module}/rewrite.js")
}

# The query string stays out of the cache key and away from S3: /r?s=<token> is one cached page, and the token never
# reaches the origin. Don't turn on access logs here without stripping query strings: they carry family links' tokens.
resource "aws_cloudfront_cache_policy" "web" {
  for_each    = local.classes
  name        = "${local.name}-${each.key}"
  min_ttl     = 0
  default_ttl = each.value.edge_ttl
  max_ttl     = each.value.edge_ttl

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    cookies_config { cookie_behavior = "none" }
    headers_config { header_behavior = "none" }
    query_strings_config { query_string_behavior = "none" }
  }
}

resource "aws_cloudfront_response_headers_policy" "web" {
  for_each = local.classes
  name     = "${local.name}-${each.key}"

  # Vercel sends Access-Control-Allow-Origin: * on every static file. CloudFront sends it when the request has an Origin.
  cors_config {
    access_control_allow_credentials = false
    origin_override                  = true
    access_control_allow_headers { items = ["*"] }
    access_control_allow_methods { items = ["GET", "HEAD"] }
    access_control_allow_origins { items = ["*"] }
  }

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 63072000
      override                   = true
    }
  }

  custom_headers_config {
    dynamic "items" {
      for_each = merge(each.value.headers, var.noindex ? { "X-Robots-Tag" = "noindex" } : {})
      content {
        header   = items.key
        value    = items.value
        override = true
      }
    }
  }
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  comment             = "homecookd ${var.environment} website"
  price_class         = "PriceClass_200" # includes India, where many cooks are
  aliases             = var.domains
  default_root_object = "index.html"

  origin {
    origin_id                = "web"
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    target_origin_id           = "web"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.web["page"].id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.web["page"].id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.rewrite.arn
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = local.behaviors
    content {
      path_pattern               = ordered_cache_behavior.value.path
      target_origin_id           = "web"
      viewer_protocol_policy     = "redirect-to-https"
      allowed_methods            = ["GET", "HEAD"]
      cached_methods             = ["GET", "HEAD"]
      compress                   = ordered_cache_behavior.value.compress
      cache_policy_id            = aws_cloudfront_cache_policy.web[ordered_cache_behavior.value.class].id
      response_headers_policy_id = aws_cloudfront_response_headers_policy.web[ordered_cache_behavior.value.class].id

      dynamic "function_association" {
        for_each = ordered_cache_behavior.value.rewrite ? [1] : []
        content {
          event_type   = "viewer-request"
          function_arn = aws_cloudfront_function.rewrite.arn
        }
      }
    }
  }

  # 60 seconds, so a file that a deploy adds isn't a stale 404 for long. A 403 from S3 is left alone on purpose: it
  # means CloudFront lost access to the bucket, and that should look broken, not like a missing page.
  custom_error_response {
    error_code            = 404
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.certificate_arn == null
    acm_certificate_arn            = var.certificate_arn
    ssl_support_method             = var.certificate_arn == null ? null : "sni-only"
    minimum_protocol_version       = var.certificate_arn == null ? null : "TLSv1.2_2021"
  }

  lifecycle {
    precondition {
      condition     = length(var.domains) == 0 || var.certificate_arn != null
      error_message = "domains needs certificate_arn: an ACM certificate in us-east-1 that covers them."
    }
  }
}

# ListBucket makes S3 answer 404 for a missing key, where it would otherwise answer 403. Only this distribution gets it,
# and viewers can't list: "/" always becomes index.html, and query strings never reach S3.
data "aws_iam_policy_document" "web_from_cloudfront" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.web.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket     = aws_s3_bucket.web.id
  policy     = data.aws_iam_policy_document.web_from_cloudfront.json
  depends_on = [aws_s3_bucket_public_access_block.web]
}

# All .github/workflows/deploy-web.yml needs: put and remove files in this bucket, and clear this distribution's cache.
resource "aws_iam_role_policy" "deploy" {
  name = "${local.name}-deploy"
  role = var.deploy_role_name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "s3:ListBucket", Resource = aws_s3_bucket.web.arn },
      { Effect = "Allow", Action = ["s3:PutObject", "s3:DeleteObject"], Resource = "${aws_s3_bucket.web.arn}/*" },
      {
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
        Resource = aws_cloudfront_distribution.web.arn
      },
    ]
  })
}
