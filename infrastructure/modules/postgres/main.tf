terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.14"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

variable "name" { type = string }
variable "resource_group_name" { type = string }
variable "location" { type = string }
variable "data_subnet_id" { type = string }
variable "private_dns_zone_id" { type = string }
variable "sku_name" {
  type    = string
  default = "GP_Standard_D2ds_v5"
}
variable "tags" { type = map(string) }

# Bootstrap admin credential generated at apply time and stored ONLY in Key
# Vault by the caller; never in tfvars. App access uses Entra authentication.
resource "random_password" "admin" {
  length  = 32
  special = false
}

resource "azurerm_postgresql_flexible_server" "this" {
  name                          = var.name
  resource_group_name           = var.resource_group_name
  location                      = var.location
  version                       = "17"
  sku_name                      = var.sku_name
  storage_mb                    = 65536
  backup_retention_days         = 35
  geo_redundant_backup_enabled  = true
  public_network_access_enabled = false
  delegated_subnet_id           = var.data_subnet_id
  private_dns_zone_id           = var.private_dns_zone_id
  zone                          = "1"
  tags                          = var.tags

  administrator_login    = "sfadmin"
  administrator_password = random_password.admin.result

  authentication {
    active_directory_auth_enabled = true
    password_auth_enabled         = true # disable once Entra-only access is validated
  }

  high_availability {
    mode                      = "ZoneRedundant"
    standby_availability_zone = "2"
  }
}

output "id" { value = azurerm_postgresql_flexible_server.this.id }
output "fqdn" { value = azurerm_postgresql_flexible_server.this.fqdn }
output "admin_password" {
  value     = random_password.admin.result
  sensitive = true
}
