output "cloudfront_domains" {
  description = "Where each address answers now, and what its DNS record points at"
  value       = { for k, d in aws_cloudfront_distribution.address : k => d.domain_name }
}
