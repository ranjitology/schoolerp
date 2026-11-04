output "s3_bucket" {
  description = "Private documents bucket."
  value       = aws_s3_bucket.documents.bucket
}

output "database_endpoint" {
  description = "RDS PostgreSQL endpoint (host:port)."
  value       = aws_db_instance.main.endpoint
  sensitive   = true
}

output "database_master_secret_arn" {
  description = "Secrets Manager ARN for the RDS managed master password."
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
  sensitive   = true
}

output "redis_endpoint" {
  description = "ElastiCache Redis endpoint."
  value       = aws_elasticache_cluster.main.cache_nodes[0].address
  sensitive   = true
}

output "data_security_group_id" {
  description = "Security group guarding RDS and Redis."
  value       = aws_security_group.data.id
}
