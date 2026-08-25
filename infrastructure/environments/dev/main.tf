# The identity running terraform — granted Key Vault Secrets Officer so the
# apply can write the database-url secret. Nothing else uses it.
data "azurerm_client_config" "current" {}

module "resource_group" {
  source   = "../../modules/resource-group"
  name     = "rg-${local.name_prefix}"
  location = var.location
  tags     = local.tags
}

module "network" {
  source              = "../../modules/network"
  name_prefix         = local.name_prefix
  resource_group_name = module.resource_group.name
  location            = module.resource_group.location
  tags                = local.tags
}

module "identity" {
  source              = "../../modules/identity"
  name_prefix         = local.name_prefix
  resource_group_name = module.resource_group.name
  location            = module.resource_group.location
  github_repository   = var.github_repository
  github_environment  = var.environment
  tags                = local.tags
}

module "monitoring" {
  source              = "../../modules/monitoring"
  name_prefix         = local.name_prefix
  resource_group_name = module.resource_group.name
  location            = module.resource_group.location
  tags                = local.tags
}

module "key_vault" {
  source               = "../../modules/key-vault"
  name                 = "kv-${replace(local.name_prefix, "-", "")}"
  resource_group_name  = module.resource_group.name
  location             = module.resource_group.location
  tenant_id            = var.tenant_id
  data_subnet_id       = module.network.data_subnet_id
  private_dns_zone_id  = module.network.private_dns_zone_ids["privatelink.vaultcore.azure.net"]
  reader_principal_ids = [module.identity.app_principal_id]

  officer_principal_ids = [data.azurerm_client_config.current.object_id]
  database_url          = module.postgres.database_url

  enable_private_networking = var.enable_private_networking
  tags                      = local.tags
}

module "postgres" {
  source              = "../../modules/postgres"
  name                = "psql-${local.name_prefix}"
  resource_group_name = module.resource_group.name
  location            = module.resource_group.location
  data_subnet_id      = module.network.data_subnet_id
  private_dns_zone_id = module.network.private_dns_zone_ids["privatelink.postgres.database.azure.com"]

  enable_private_networking = var.enable_private_networking
  tags                      = local.tags
}

module "storage" {
  source              = "../../modules/storage"
  name                = "st${replace(local.name_prefix, "-", "")}ev"
  resource_group_name = module.resource_group.name
  location            = module.resource_group.location
  data_subnet_id      = module.network.data_subnet_id
  private_dns_zone_id = module.network.private_dns_zone_ids["privatelink.blob.core.windows.net"]

  enable_private_networking = var.enable_private_networking
  tags                      = local.tags
}

module "entra_app" {
  count             = var.auth_enabled ? 1 : 0
  source            = "../../modules/entra-app"
  display_name      = local.name_prefix
  spa_redirect_uris = var.spa_redirect_uris
}

module "container_apps" {
  source                     = "../../modules/container-apps"
  name_prefix                = local.name_prefix
  resource_group_name        = module.resource_group.name
  location                   = module.resource_group.location
  app_subnet_id              = module.network.app_subnet_id
  log_analytics_workspace_id = module.monitoring.workspace_id
  app_identity_id            = module.identity.app_identity_id
  api_image                  = var.api_image
  key_vault_uri              = module.key_vault.uri
  database_url_secret_id     = module.key_vault.database_url_secret_id

  enable_private_networking = var.enable_private_networking
  auth_enabled              = var.auth_enabled
  entra_tenant_id           = var.auth_enabled ? module.entra_app[0].tenant_id : ""
  entra_client_id           = var.auth_enabled ? module.entra_app[0].client_id : ""
  tags                      = local.tags

  # The secret id alone does not order the app behind the app identity's
  # Key Vault Secrets User assignment; without this the first revision can
  # start before it can read database-url.
  depends_on = [module.key_vault]
}

output "api_fqdn" {
  value = module.container_apps.api_fqdn
}
