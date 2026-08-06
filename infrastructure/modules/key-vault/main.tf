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

output "id" { value = azurerm_key_vault.this.id }
output "uri" { value = azurerm_key_vault.this.vault_uri }
