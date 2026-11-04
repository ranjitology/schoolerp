variable "aws_region" {
  description = "Region for the platform data plane."
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  description = "Deployment environment (staging, production)."
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
  default     = "schoolerp"
}

variable "db_instance_class" {
  description = "RDS instance class. Size for 500 concurrent morning-peak users."
  type        = string
  default     = "db.t4g.medium"
}

variable "db_allocated_storage_gb" {
  description = "Initial RDS storage in GiB (autoscaling enabled)."
  type        = number
  default     = 100
}

variable "db_max_allocated_storage_gb" {
  description = "Upper bound for RDS storage autoscaling."
  type        = number
  default     = 500
}

variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.micro"
}

variable "vpc_id" {
  description = "VPC for RDS/ElastiCache. Empty uses the account default VPC."
  type        = string
  default     = ""
}

variable "private_subnet_ids" {
  description = "Private subnets for data services. Empty uses the default VPC subnets."
  type        = list(string)
  default     = []
}

variable "app_security_group_id" {
  description = "Security group id of the API workload allowed to reach data services."
  type        = string
  default     = ""
}

variable "rds_backup_retention_days" {
  description = "Automated backup retention; point-in-time recovery window."
  type        = number
  default     = 14
}
