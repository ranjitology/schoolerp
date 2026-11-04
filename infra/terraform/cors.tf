variable "allowed_origins" {
  description = "Origins allowed to upload/download directly from S3 via signed URLs."
  type        = list(string)
  default     = ["https://app.schoolerp.app", "https://admin.schoolerp.app"]
}
