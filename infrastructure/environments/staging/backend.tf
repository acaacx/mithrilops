terraform {
  required_version = ">= 1.9.0"

  # Remote state with locking. The storage account is bootstrapped once,
  # out-of-band, with versioning + private endpoint (see docs/deployment.md).
  backend "azurerm" {
    resource_group_name  = "rg-secureflow-tfstate"
    storage_account_name = "stsecureflowtfstate"
    container_name       = "tfstate"
    key                  = "secureflow/staging.tfstate"
    use_azuread_auth     = true # no storage keys; identity-based state access
  }

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.14"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.1"
    }
  }
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = false
    }
  }
  # Credentials come from OIDC federation (GitHub Actions) or az login locally.
  use_oidc = true
}

provider "azuread" {
  # Same OIDC federation / az login credentials as azurerm.
  use_oidc = true
}
