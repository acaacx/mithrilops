# Non-secret configuration only. Tenant/subscription come from the pipeline
# environment; secrets live in Key Vault, never in tfvars.
environment       = "prod"
location          = "westeurope"
tenant_id         = "00000000-0000-0000-0000-000000000000" # placeholder — set per tenant
github_repository = "acaacx/mithrilops"
api_image         = "ghcr.io/acaacx/mithrilops/secureflow-api@sha256:15daef5253e0d822db45d6af3424bb0ca346500a0c447e7ad24a839915e4006c"

enable_private_networking = true
