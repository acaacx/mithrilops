terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.14"
    }
  }
}

variable "name" {
  description = "Resource group name (naming convention: rg-<app>-<env>)"
  type        = string
}

variable "location" {
  type    = string
  default = "westeurope"
}

variable "tags" {
  description = "Mandatory tags (owner, environment, cost-center, data-classification)"
  type        = map(string)

  validation {
    condition     = alltrue([for k in ["owner", "environment", "cost-center"] : contains(keys(var.tags), k)])
    error_message = "Tags must include owner, environment, and cost-center."
  }
}

resource "azurerm_resource_group" "this" {
  name     = var.name
  location = var.location
  tags     = var.tags
}

output "name" {
  value = azurerm_resource_group.this.name
}

output "location" {
  value = azurerm_resource_group.this.location
}

output "id" {
  value = azurerm_resource_group.this.id
}
