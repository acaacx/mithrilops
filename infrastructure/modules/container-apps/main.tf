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
variable "tags" { type = map(string) }

variable "enable_private_networking" {
  description = "Provision private endpoints / VNet integration. Off keeps dev cheap on public endpoints; on for staging and prod."
  type        = bool
  default     = true
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
    }
  }
}

output "environment_id" { value = azurerm_container_app_environment.this.id }
output "api_fqdn" { value = azurerm_container_app.api.ingress[0].fqdn }
