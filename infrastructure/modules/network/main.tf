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
variable "address_space" {
  type    = list(string)
  default = ["10.20.0.0/16"]
}
variable "tags" { type = map(string) }

resource "azurerm_virtual_network" "this" {
  name                = "vnet-${var.name_prefix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  address_space       = var.address_space
  tags                = var.tags
}

resource "azurerm_subnet" "app" {
  name                 = "snet-${var.name_prefix}-app"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [cidrsubnet(var.address_space[0], 8, 1)]
}

resource "azurerm_subnet" "data" {
  name                 = "snet-${var.name_prefix}-data"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [cidrsubnet(var.address_space[0], 8, 2)]

  private_endpoint_network_policies = "Enabled"
}

resource "azurerm_network_security_group" "data" {
  name                = "nsg-${var.name_prefix}-data"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags

  # Deny-by-default: no inbound from internet; PaaS reached via private endpoints only.
  security_rule {
    name                       = "deny-internet-inbound"
    priority                   = 4096
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "data" {
  subnet_id                 = azurerm_subnet.data.id
  network_security_group_id = azurerm_network_security_group.data.id
}

# Private DNS zones for private-endpoint resolution.
resource "azurerm_private_dns_zone" "zones" {
  for_each = toset([
    "privatelink.vaultcore.azure.net",
    "privatelink.postgres.database.azure.com",
    "privatelink.blob.core.windows.net",
  ])
  name                = each.value
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "links" {
  for_each              = azurerm_private_dns_zone.zones
  name                  = "link-${var.name_prefix}-${replace(each.value.name, ".", "-")}"
  resource_group_name   = var.resource_group_name
  private_dns_zone_name = each.value.name
  virtual_network_id    = azurerm_virtual_network.this.id
}

output "vnet_id" { value = azurerm_virtual_network.this.id }
output "app_subnet_id" { value = azurerm_subnet.app.id }
output "data_subnet_id" { value = azurerm_subnet.data.id }
output "private_dns_zone_ids" {
  value = { for k, z in azurerm_private_dns_zone.zones : k => z.id }
}
