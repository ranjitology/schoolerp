# Terraform skeleton (data plane)

This directory provisions the managed data plane for SchoolERP:

- PostgreSQL 16 on RDS (encryption, PITR, Performance Insights, Multi-AZ in production)
- Redis 7 on ElastiCache
- Private, versioned, KMS-encrypted S3 bucket for documents
- Security groups restricting data services to the API workload

It is intentionally a **skeleton**: the compute layer (ECS/EKS/Fargate or VMs), DNS
and TLS, and the remote state backend are environment-specific and must be added
before a real apply.

## Usage

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan -out plan.bin
terraform apply plan.bin
```

Never commit `terraform.tfvars`, state files or plan files. Configure the S3 +
DynamoDB backend in `versions.tf` before using this in a team environment.

## Relationship to Docker Compose

Compose is the local/demo environment. Production must point the API at the RDS
and ElastiCache endpoints from the outputs above and use the application role
(`erp_app`) — never the RDS master user. The master password lives in Secrets
Manager (`manage_master_user_password = true`).

## Restore drills

RDS automated backups support point-in-time recovery. The runbook in
`docs/runbook.md` covers quarterly restore drills and validates the RPO ≤ 15m /
RTO ≤ 2h targets.
