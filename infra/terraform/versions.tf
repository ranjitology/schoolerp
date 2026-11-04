terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Configure a remote backend before applying in a shared environment.
  # backend "s3" {
  #   bucket         = "schoolerp-terraform-state"
  #   key            = "platform/terraform.tfstate"
  #   region         = "ap-south-1"
  #   dynamodb_table = "schoolerp-terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "schoolerp"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
