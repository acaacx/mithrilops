terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.14"
    }
  }
}

variable "name" { type = string }
variable "resource_group_name" { type = string }
variable "location" { type = string }
variable "tenant_id" { type = string }
variable "data_subnet_id" { type = string }
variable "private_dns_zone_id" { type = string }
variable "reader_principal_ids" {
  description = "Managed identities granted Key Vault Secrets User (least privilege)"
  type        = list(string)
  default     = []
}
variable "officer_principal_ids" {
  description = "Principals granted Key Vault Secrets Officer so Terraform can write the secrets below. The apply identity, nothing else."
  type        = list(string)
  default     = []
}
variable "database_url" {
  description = "Postgres connection URL stored as the database-url secret and referenced by the container app."
  type        = string
  sensitive   = true
}
variable "tags" { type = map(string) }

variable "enable_private_networking" {
  description = "Provision private endpoints / VNet integration. Off keeps dev cheap on public endpoints; on for staging and prod."
  type        = bool
  default     = true
}

resource "azurerm_key_vault" "this" {
  name                          = var.name
  resource_group_name           = var.resource_group_name
  location                      = var.location
  tenant_id                     = var.tenant_id
  sku_name                      = "standard"
  purge_protection_enabled      = true
  soft_delete_retention_days    = 90
  enable_rbac_authorization     = true
  public_network_access_enabled = !var.enable_private_networking
  tags                          = var.tags

  network_acls {
    default_action = var.enable_private_networking ? "Deny" : "Allow"
    bypass         = "AzureServices"
  }
}

resource "azurerm_private_endpoint" "kv" {
  count               = var.enable_private_networking ? 1 : 0
  name                = "pe-${var.name}"
  resource_group_name = var.resource_group_name
  location            = var.location
  subnet_id           = var.data_subnet_id
  tags                = var.tags

  private_service_connection {
    name                           = "psc-${var.name}"
    private_connection_resource_id = azurerm_key_vault.this.id
    subresource_names              = ["vault"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "dns-${var.name}"
    private_dns_zone_ids = [var.private_dns_zone_id]
  }
}

resource "azurerm_role_assignment" "secrets_user" {
  for_each             = toset(var.reader_principal_ids)
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = each.value
}

resource "azurerm_role_assignment" "secrets_officer" {
  for_each             = toset(var.officer_principal_ids)
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = each.value
}

# The one secret the app cannot start without. Written by the apply identity,
# read by the app's managed identity through a versionless reference so a
# rotated password is picked up without a container app revision change.
resource "azurerm_key_vault_secret" "db_url" {
  # checkov:skip=CKV_AZURE_41: a hard expiry on the connection URL takes the
  # API down the moment it lapses. Rotation is driven by re-applying the
  # postgres module (new password -> new secret version), not by expiry.
  name         = "database-url"
  value        = var.database_url
  key_vault_id = azurerm_key_vault.this.id
  content_type = "text/plain"
  tags         = var.tags

  depends_on = [azurerm_role_assignment.secrets_officer]
}

output "id" { value = azurerm_key_vault.this.id }
output "uri" { value = azurerm_key_vault.this.vault_uri }
output "database_url_secret_id" { value = azurerm_key_vault_secret.db_url.versionless_id }
