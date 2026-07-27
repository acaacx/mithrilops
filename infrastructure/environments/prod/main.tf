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
  alert_email         = var.alert_email
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
  tags                 = local.tags
}

module "acr" {
  source              = "../../modules/acr"
  name                = "acr${replace(local.name_prefix, "-", "")}"
  resource_group_name = module.resource_group.name
  location            = module.resource_group.location
  data_subnet_id      = module.network.data_subnet_id
  private_dns_zone_id = module.network.private_dns_zone_ids["privatelink.azurecr.io"]
  pull_principal_ids  = [module.identity.app_principal_id]
  tags                = local.tags
}

module "postgres" {
  source              = "../../modules/postgres"
  name                = "psql-${local.name_prefix}"
  resource_group_name = module.resource_group.name
  location            = module.resource_group.location
  data_subnet_id      = module.network.data_subnet_id
  private_dns_zone_id = module.network.private_dns_zone_ids["privatelink.postgres.database.azure.com"]
  tags                = local.tags
}

module "redis" {
  source              = "../../modules/redis"
  name                = "redis-${local.name_prefix}"
  resource_group_name = module.resource_group.name
  location            = module.resource_group.location
  data_subnet_id      = module.network.data_subnet_id
  private_dns_zone_id = module.network.private_dns_zone_ids["privatelink.redis.cache.windows.net"]
  tags                = local.tags
}

module "storage" {
  source              = "../../modules/storage"
  name                = "st${replace(local.name_prefix, "-", "")}ev"
  resource_group_name = module.resource_group.name
  location            = module.resource_group.location
  data_subnet_id      = module.network.data_subnet_id
  private_dns_zone_id = module.network.private_dns_zone_ids["privatelink.blob.core.windows.net"]
  tags                = local.tags
}

module "container_apps" {
  source                     = "../../modules/container-apps"
  name_prefix                = local.name_prefix
  resource_group_name        = module.resource_group.name
  location                   = module.resource_group.location
  app_subnet_id              = module.network.app_subnet_id
  log_analytics_workspace_id = module.monitoring.workspace_id
  acr_login_server           = module.acr.login_server
  app_identity_id            = module.identity.app_identity_id
  api_image                  = var.api_image
  key_vault_uri              = module.key_vault.uri
  tags                       = local.tags
}

module "static_web_app" {
  source              = "../../modules/static-web-app"
  name                = "swa-${local.name_prefix}"
  resource_group_name = module.resource_group.name
  tags                = local.tags
}

output "web_hostname" {
  value = module.static_web_app.default_host_name
}

output "api_fqdn" {
  value = module.container_apps.api_fqdn
}
