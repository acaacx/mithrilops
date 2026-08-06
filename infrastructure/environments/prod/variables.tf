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

variable "enable_private_networking" {
  description = "Private endpoints + VNet integration. Off for dev (cost), on for staging/prod."
  type        = bool
  default     = false
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
