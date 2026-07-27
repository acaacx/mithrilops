# Non-secret configuration only. Tenant/subscription come from the pipeline
# environment; secrets live in Key Vault, never in tfvars.
environment       = "dev"
location          = "westeurope"
tenant_id         = "00000000-0000-0000-0000-000000000000" # placeholder — set per tenant
github_repository = "meridian/secureflow-control-center"
alert_email       = "platform-oncall@example.com"
api_image         = "acrsecureflowdev.azurecr.io/secureflow-api@sha256:0000000000000000000000000000000000000000000000000000000000000000"
