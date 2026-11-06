resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_security_group" "db" {
  name   = "${local.name}-db"
  vpc_id = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "db_from_service" {
  for_each                     = { for k, s in var.services : k => s if s.uses_database }
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.service[each.key].id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_db_instance" "main" {
  identifier                  = local.name
  engine                      = "postgres"
  engine_version              = "17"
  instance_class              = var.db_instance_class
  allocated_storage           = var.db_allocated_gb
  max_allocated_storage       = var.db_allocated_gb * 5
  storage_type                = "gp3"
  storage_encrypted           = true
  db_name                     = "homecookd"
  username                    = "homecookd"
  manage_master_user_password = true # RDS makes the password and keeps it in Secrets Manager; nobody types it
  multi_az                    = var.db_multi_az
  db_subnet_group_name        = aws_db_subnet_group.main.name
  vpc_security_group_ids      = [aws_security_group.db.id]
  publicly_accessible         = false
  backup_retention_period     = var.db_backup_days
  deletion_protection         = var.db_protected
  skip_final_snapshot         = !var.db_protected
  final_snapshot_identifier   = var.db_protected ? "${local.name}-final" : null
  copy_tags_to_snapshot       = true
  # The api and worker log in with IAM tokens, so their logins have no password at all (db_logins below). Turning it on changes no
  # existing login. Without apply_immediately it waits for the maintenance window (infra/README.md, "Database logins").
  iam_database_authentication_enabled = true
}

locals {
  # Each service's own Postgres login, made by api/migrations/078_app_logins.sql: rows only, no schema changes. Only the migrate task
  # (services.tf) keeps the master login. A new service that uses the database needs its own role there, and a line here.
  db_logins = { api = "homecookd_api", worker = "homecookd_worker" }
}
