data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "aws_vpc" "default" {
  count   = var.vpc_id == "" ? 1 : 0
  default = true
}

data "aws_subnets" "default" {
  count = length(var.private_subnet_ids) == 0 ? 1 : 0

  filter {
    name   = "vpc-id"
    values = [var.vpc_id == "" ? data.aws_vpc.default[0].id : var.vpc_id]
  }
}

locals {
  vpc_id     = var.vpc_id == "" ? data.aws_vpc.default[0].id : var.vpc_id
  subnet_ids = length(var.private_subnet_ids) > 0 ? var.private_subnet_ids : data.aws_subnets.default[0].ids
  app_sg     = var.app_security_group_id == "" ? aws_security_group.app[0].id : var.app_security_group_id
}

resource "random_id" "suffix" {
  byte_length = 4
}

# --- Object storage ---------------------------------------------------------

resource "aws_s3_bucket" "documents" {
  bucket = "${var.name_prefix}-${var.environment}-documents-${random_id.suffix.hex}"
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket                  = aws_s3_bucket.documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    id     = "expire-incomplete-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 3
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  cors_rule {
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = var.allowed_origins
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# --- Network ----------------------------------------------------------------

resource "aws_security_group" "app" {
  count       = var.app_security_group_id == "" ? 1 : 0
  name        = "${var.name_prefix}-${var.environment}-app"
  description = "API workloads"
  vpc_id      = local.vpc_id
}

resource "aws_security_group" "data" {
  name        = "${var.name_prefix}-${var.environment}-data"
  description = "RDS and Redis; reachable only from the API security group"
  vpc_id      = local.vpc_id

  ingress {
    description     = "PostgreSQL"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [local.app_sg]
  }

  ingress {
    description     = "Redis"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [local.app_sg]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# --- PostgreSQL -------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  name       = "${var.name_prefix}-${var.environment}"
  subnet_ids = local.subnet_ids
}

resource "aws_db_parameter_group" "main" {
  name   = "${var.name_prefix}-${var.environment}-pg16"
  family = "postgres16"

  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }

  parameter {
    name  = "idle_in_transaction_session_timeout"
    value = "60000"
  }

  parameter {
    name  = "statement_timeout"
    value = "30000"
  }
}

resource "aws_db_instance" "main" {
  identifier = "${var.name_prefix}-${var.environment}"

  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage_gb
  max_allocated_storage = var.db_max_allocated_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "schoolerp"
  username = "postgres"
  manage_master_user_password = true
  port     = 5432

  multi_az                = var.environment == "production"
  db_subnet_group_name    = aws_db_subnet_group.main.name
  vpc_security_group_ids  = [aws_security_group.data.id]
  parameter_group_name    = aws_db_parameter_group.main.name
  backup_retention_period = var.rds_backup_retention_days
  backup_window           = "18:00-19:00" # 23:45-00:45 Asia/Kathmandu
  maintenance_window      = "sun:19:00-sun:20:00"

  performance_insights_enabled = true
  monitoring_interval          = 60
  deletion_protection          = var.environment == "production"
  skip_final_snapshot          = var.environment != "production"
  final_snapshot_identifier    = var.environment == "production" ? "${var.name_prefix}-${var.environment}-final" : null

  auto_minor_version_upgrade = true
  apply_immediately          = false

  lifecycle {
    prevent_destroy = false
  }
}

# --- Redis ------------------------------------------------------------------

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.name_prefix}-${var.environment}"
  subnet_ids = local.subnet_ids
}

resource "aws_elasticache_cluster" "main" {
  cluster_id           = "${var.name_prefix}-${var.environment}"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.redis_node_type
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.data.id]

  snapshot_retention_limit = 7
  snapshot_window          = "17:00-18:00"
  maintenance_window       = "sun:18:00-sun:19:00"
  apply_immediately        = false
}
