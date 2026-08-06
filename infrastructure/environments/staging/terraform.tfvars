# Non-secret configuration only. Tenant/subscription come from the pipeline
# environment; secrets live in Key Vault, never in tfvars.
environment       = "staging"
location          = "westeurope"
tenant_id         = "00000000-0000-0000-0000-000000000000" # placeholder — set per tenant
github_repository = "meridian/secureflow-control-center"
api_image         = "ghcr.io/meridian/secureflow-control-center/secureflow-api@sha256:0000000000000000000000000000000000000000000000000000000000000000"

enable_private_networking = true
