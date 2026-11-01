output "url" {
  value = "https://${length(var.domains) > 0 ? var.domains[0] : aws_cloudfront_distribution.web.domain_name}"
}

output "bucket" {
  value = aws_s3_bucket.web.id
}

output "distribution_id" {
  value = aws_cloudfront_distribution.web.id
}
