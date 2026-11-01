resource "aws_s3_bucket" "media" {
  bucket = "${local.name}-media-${local.account_id}"
}

resource "aws_s3_bucket" "uploads" {
  bucket = "${local.name}-uploads-${local.account_id}"
}

# Voice notes and photos between family members: never on the CDN's public path, read only with short presigned links.
resource "aws_s3_bucket" "private" {
  bucket = "${local.name}-private-${local.account_id}"
}

resource "aws_s3_bucket_public_access_block" "private" {
  bucket                  = aws_s3_bucket.private.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "private" {
  bucket = aws_s3_bucket.private.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_lifecycle_configuration" "private" {
  bucket     = aws_s3_bucket.private.id
  depends_on = [aws_s3_bucket_versioning.private]
  rule {
    id     = "old-versions-and-abandoned-uploads"
    status = "Enabled"
    filter {}
    expiration { expired_object_delete_marker = true }
    noncurrent_version_expiration { noncurrent_days = 28 }
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# A family's videos are the product: an overwrite or delete can be undone for 28 days. /privacy says deleted within 30 days,
# out of backups within 30 more, and S3's expiry can run a little late, so this stays under 30.
resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket     = aws_s3_bucket.media.id
  depends_on = [aws_s3_bucket_versioning.media]
  rule {
    id     = "old-versions"
    status = "Enabled"
    filter {}
    expiration { expired_object_delete_marker = true }
    noncurrent_version_expiration { noncurrent_days = 28 }
  }
}

# The raw footage can't be filmed again. Same undo window as media.
resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket     = aws_s3_bucket.uploads.id
  depends_on = [aws_s3_bucket_versioning.uploads]
  rule {
    id     = "old-versions-and-abandoned-uploads"
    status = "Enabled"
    filter {}
    expiration { expired_object_delete_marker = true }
    noncurrent_version_expiration { noncurrent_days = 28 }
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}

# The same rule as cloud/media-cors.json.
resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  cors_rule {
    allowed_origins = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_headers = ["*"]
    expose_headers  = ["Content-Type", "Content-Range", "Accept-Ranges"]
    max_age_seconds = 3600
  }
}

resource "aws_cloudfront_origin_access_control" "media" {
  name                              = "${local.name}-media"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_origin_request_policy" "cors" {
  name = "Managed-CORS-S3Origin"
}

resource "aws_cloudfront_distribution" "media" {
  enabled         = true
  is_ipv6_enabled = true
  price_class     = "PriceClass_200" # includes India, where many cooks are
  aliases         = var.media_domain == null ? [] : [var.media_domain]

  origin {
    origin_id                = "media"
    domain_name              = aws_s3_bucket.media.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.media.id
  }

  default_cache_behavior {
    target_origin_id         = "media"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.optimized.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.cors.id
    compress                 = true
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.media_certificate_arn == null
    acm_certificate_arn            = var.media_certificate_arn
    ssl_support_method             = var.media_certificate_arn == null ? null : "sni-only"
    minimum_protocol_version       = var.media_certificate_arn == null ? null : "TLSv1.2_2021"
  }
}

data "aws_iam_policy_document" "media_from_cloudfront" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.media.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.media.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "media" {
  bucket     = aws_s3_bucket.media.id
  policy     = data.aws_iam_policy_document.media_from_cloudfront.json
  depends_on = [aws_s3_bucket_public_access_block.media]
}
