output "load_balancer_url" {
  value = "${var.certificate_arn == null ? "http" : "https"}://${aws_lb.main.dns_name}"
}

output "media_url" {
  value = "https://${var.media_domain != null ? var.media_domain : aws_cloudfront_distribution.media.domain_name}"
}

output "deploy_role_arn" {
  value = aws_iam_role.deploy.arn
}

output "database_endpoint" {
  value = aws_db_instance.main.address
}
