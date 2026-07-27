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
variable "github_repository" {
  description = "GitHub org/repo federated with this identity (OIDC — no client secrets)"
  type        = string
}
variable "github_environment" {
  description = "GitHub environment name the federation is scoped to"
  type        = string
}
variable "tags" { type = map(string) }

# Workload identity for the application runtime.
resource "azurerm_user_assigned_identity" "app" {
  name                = "id-${var.name_prefix}-app"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags
}

# Deployment identity used by GitHub Actions via OIDC federation.
resource "azurerm_user_assigned_identity" "deploy" {
  name                = "id-${var.name_prefix}-deploy"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags
}

resource "azurerm_federated_identity_credential" "github" {
  name                = "gh-${var.name_prefix}-${var.github_environment}"
  resource_group_name = var.resource_group_name
  parent_id           = azurerm_user_assigned_identity.deploy.id
  audience            = ["api://AzureADTokenExchange"]
  issuer              = "https://token.actions.githubusercontent.com"
  subject             = "repo:${var.github_repository}:environment:${var.github_environment}"
}

output "app_principal_id" { value = azurerm_user_assigned_identity.app.principal_id }
output "app_identity_id" { value = azurerm_user_assigned_identity.app.id }
output "deploy_principal_id" { value = azurerm_user_assigned_identity.deploy.principal_id }
output "deploy_client_id" { value = azurerm_user_assigned_identity.deploy.client_id }
