variable "environment" {
  type = string
}

variable "location" {
  type    = string
  default = "westeurope"
}

variable "tenant_id" {
  type = string
}

variable "github_repository" {
  description = "org/repo federated for deployments via OIDC"
  type        = string
}

variable "api_image" {
  description = "Digest-pinned image for the API"
  type        = string
}

locals {
  name_prefix = "secureflow-${var.environment}"

  tags = {
    owner                 = "platform-engineering"
    environment           = var.environment
    "cost-center"         = "cc-platform-7040"
    "data-classification" = "internal"
    "managed-by"          = "terraform"
  }
}
