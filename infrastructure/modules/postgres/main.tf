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
variable "database_name" {
  description = "Application database created on the server; must match the database in DATABASE_URL."
  type        = string
  default     = "secureflow"
}
variable "tags" { type = map(string) }

variable "enable_private_networking" {
  description = "Provision private endpoints / VNet integration. Off keeps dev cheap on public endpoints; on for staging and prod."
  type        = bool
  default     = true
}

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
  public_network_access_enabled = !var.enable_private_networking
  delegated_subnet_id           = var.enable_private_networking ? var.data_subnet_id : null
  private_dns_zone_id           = var.enable_private_networking ? var.private_dns_zone_id : null
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

resource "azurerm_postgresql_flexible_server_database" "app" {
  name      = var.database_name
  server_id = azurerm_postgresql_flexible_server.this.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

# With the VNet gate off (dev) the server has a public endpoint and no route
# from the container app, which egresses from an Azure-owned address. The
# 0.0.0.0-0.0.0.0 range is Azure's "allow public access from any Azure
# service" pseudo-rule, not 0.0.0.0/0. Private mode uses the delegated subnet
# and needs no rule at all.
resource "azurerm_postgresql_flexible_server_firewall_rule" "azure_services" {
  # checkov:skip=CKV2_AZURE_26: 0.0.0.0-0.0.0.0 is Azure's "allow Azure
  # services" pseudo-rule, not 0.0.0.0/0, and the resource only exists when
  # the VNet gate is off (dev). Staging and prod reach the server over the
  # delegated subnet and create no rule at all.
  count            = var.enable_private_networking ? 0 : 1
  name             = "AllowAzureServices"
  server_id        = azurerm_postgresql_flexible_server.this.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

output "id" { value = azurerm_postgresql_flexible_server.this.id }
output "fqdn" { value = azurerm_postgresql_flexible_server.this.fqdn }
output "database_name" { value = azurerm_postgresql_flexible_server_database.app.name }
output "admin_password" {
  value     = random_password.admin.result
  sensitive = true
}

# SQLAlchemy/asyncpg connection URL. `ssl=require` is mandatory: the flexible
# server runs with require_secure_transport on, and asyncpg takes `ssl`, not
# libpq's `sslmode`. The generated password has no special characters, so it
# needs no percent-encoding here.
output "database_url" {
  value     = "postgresql+asyncpg://${azurerm_postgresql_flexible_server.this.administrator_login}:${random_password.admin.result}@${azurerm_postgresql_flexible_server.this.fqdn}:5432/${azurerm_postgresql_flexible_server_database.app.name}?ssl=require"
  sensitive = true
}
