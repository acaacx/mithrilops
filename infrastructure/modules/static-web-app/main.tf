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
variable "location" {
  type    = string
  default = "westeurope"
}
variable "tags" { type = map(string) }

resource "azurerm_static_web_app" "this" {
  name                = var.name
  resource_group_name = var.resource_group_name
  location            = var.location
  sku_tier            = "Standard"
  sku_size            = "Standard"
  tags                = var.tags
}

output "id" { value = azurerm_static_web_app.this.id }
output "default_host_name" { value = azurerm_static_web_app.this.default_host_name }
