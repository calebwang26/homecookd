output "load_balancer_url" {
  value = "${var.certificate_arn == null ? "http" : "https"}://${aws_lb.main.dns_name}"
}

output "media_url" {
  value = local.media_url
}

# The names a DNS record points at. media_url shows media_domain once it's set, so CloudFront's own name is here too.
output "load_balancer_dns" {
  value = aws_lb.main.dns_name
}

output "media_cloudfront_domain" {
  value = aws_cloudfront_distribution.media.domain_name
}

output "deploy_role_arn" {
  value = aws_iam_role.deploy.arn
}

output "deploy_role_name" {
  value = aws_iam_role.deploy.name
}

output "database_endpoint" {
  value = aws_db_instance.main.address
}

# Where the alarms email, for an env's own alarms outside this module (envs/production/uptime.tf, in us-east-1).
output "alert_email" {
  value = var.alert_email
}
