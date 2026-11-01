output "load_balancer_url" {
  value = "${var.certificate_arn == null ? "http" : "https"}://${aws_lb.main.dns_name}"
}

output "media_url" {
  value = local.media_url
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
