# Names only. Values never go in Terraform (they would land in its state file): see infra/scripts/load-secrets.sh.
resource "aws_secretsmanager_secret" "app" {
  for_each                = var.secret_names
  name                    = "homecookd/${var.environment}/${each.key}"
  recovery_window_in_days = var.db_protected ? 30 : 0
}
