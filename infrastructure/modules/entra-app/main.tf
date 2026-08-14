terraform {
  required_providers {
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.1"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

variable "display_name" { type = string }
variable "spa_redirect_uris" {
  description = "SPA redirect URIs. localhost for dev; add the container app FQDN after the first apply."
  type        = list(string)
}
# Role values must match packages/types/src/role-permissions.json verbatim —
# the API trusts the token's roles claim as Role strings.
locals {
  app_roles = [
    "developer",
    "devsecops-engineer",
    "security-engineer",
    "platform-engineer",
    "application-owner",
    "compliance-reviewer",
    "release-approver",
    "administrator",
  ]
}

data "azuread_client_config" "current" {}

resource "random_uuid" "access_scope" {}

resource "random_uuid" "app_role" {
  for_each = toset(local.app_roles)
}

resource "azuread_application" "spa" {
  display_name     = var.display_name
  sign_in_audience = "AzureADMyOrg"

  single_page_application {
    redirect_uris = var.spa_redirect_uris
  }

  api {
    requested_access_token_version = 2

    oauth2_permission_scope {
      id                         = random_uuid.access_scope.result
      value                      = "access"
      type                       = "User"
      admin_consent_display_name = "Access SecureFlow API"
      admin_consent_description  = "Allows the SPA to call the SecureFlow API as the signed-in user."
      user_consent_display_name  = "Access SecureFlow API"
      user_consent_description   = "Allows the SPA to call the SecureFlow API on your behalf."
      enabled                    = true
    }
  }

  dynamic "app_role" {
    for_each = toset(local.app_roles)
    content {
      id                   = random_uuid.app_role[app_role.value].result
      value                = app_role.value
      display_name         = app_role.value
      description          = "SecureFlow role: ${app_role.value}"
      allowed_member_types = ["User"]
      enabled              = true
    }
  }
}

# api://<client_id> — set post-creation to avoid a self-reference cycle.
resource "azuread_application_identifier_uri" "spa" {
  application_id = azuread_application.spa.id
  identifier_uri = "api://${azuread_application.spa.client_id}"
}

# Required so users can be assigned to the app roles.
resource "azuread_service_principal" "spa" {
  client_id = azuread_application.spa.client_id
}

output "client_id" { value = azuread_application.spa.client_id }
output "tenant_id" { value = data.azuread_client_config.current.tenant_id }
