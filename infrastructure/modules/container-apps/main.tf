terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.14"
    }
  }
}

variable "name_prefix" { type = string }
variable "resource_group_name" { type = string }
variable "location" { type = string }
variable "app_subnet_id" { type = string }
variable "log_analytics_workspace_id" { type = string }
variable "app_identity_id" { type = string }
variable "api_image" {
  description = "Fully qualified image reference (digest-pinned in production)"
  type        = string
}
variable "key_vault_uri" { type = string }
variable "database_url_secret_id" {
  description = "Versionless Key Vault secret id holding DATABASE_URL. Resolved at runtime by the app's managed identity."
  type        = string
}
variable "tags" { type = map(string) }

variable "enable_private_networking" {
  description = "Provision private endpoints / VNet integration. Off keeps dev cheap on public endpoints; on for staging and prod."
  type        = bool
  default     = true
}

variable "auth_enabled" {
  description = "Inject Entra ID JWT enforcement env into the API container. Off preserves the open demo posture."
  type        = bool
  default     = false
}
variable "entra_tenant_id" {
  type    = string
  default = ""
}
variable "entra_client_id" {
  type    = string
  default = ""
}

resource "azurerm_container_app_environment" "this" {
  name                           = "cae-${var.name_prefix}"
  resource_group_name            = var.resource_group_name
  location                       = var.location
  log_analytics_workspace_id     = var.log_analytics_workspace_id
  infrastructure_subnet_id       = var.enable_private_networking ? var.app_subnet_id : null
  internal_load_balancer_enabled = var.enable_private_networking
  tags                           = var.tags
}

resource "azurerm_container_app" "api" {
  name                         = "ca-${var.name_prefix}-api"
  resource_group_name          = var.resource_group_name
  container_app_environment_id = azurerm_container_app_environment.this.id
  revision_mode                = "Single"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.app_identity_id]
  }

  # Key Vault reference, not a literal: the value never enters terraform state
  # for this resource, and the app identity (Key Vault Secrets User) resolves
  # it on revision start.
  secret {
    name                = "database-url"
    identity            = var.app_identity_id
    key_vault_secret_id = var.database_url_secret_id
  }

  ingress {
    external_enabled = !var.enable_private_networking # private ingress when the VNet is on
    target_port      = 4000
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = 1
    max_replicas = 5

    container {
      name   = "api"
      image  = var.api_image
      cpu    = 0.5
      memory = "1Gi"

      env {
        name  = "KEY_VAULT_URI"
        value = var.key_vault_uri
      }

      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }

      dynamic "env" {
        for_each = var.auth_enabled ? {
          AUTH_ENABLED    = "1"
          ENTRA_TENANT_ID = var.entra_tenant_id
          ENTRA_CLIENT_ID = var.entra_client_id
        } : {}
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }
}

output "environment_id" { value = azurerm_container_app_environment.this.id }
output "api_fqdn" { value = azurerm_container_app.api.ingress[0].fqdn }
