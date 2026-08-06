# Deployment guide

## One-time bootstrap (per Azure tenant)

1. Create the state backend (outside Terraform):
   ```bash
   az group create -n rg-secureflow-tfstate -l westeurope
   az storage account create -n stsecureflowtfstate -g rg-secureflow-tfstate \
     --sku Standard_GZRS --min-tls-version TLS1_2 --allow-blob-public-access false
   az storage container create -n tfstate --account-name stsecureflowtfstate --auth-mode login
   ```
2. Create the Entra app/identity for GitHub OIDC or let `modules/identity` manage the federated credential, then set repository **variables** (not secrets): `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`.
3. Configure GitHub environments `development` and `production`; add **required reviewers** on `production` — this is the human approval gate.
4. Set real values in `infrastructure/environments/<env>/terraform.tfvars` (tenant id, alert email, repo). No secrets go in tfvars.

## Per-environment rollout

```bash
cd infrastructure/environments/dev
terraform init
terraform plan -out=tfplan     # review: counts, policy, cost
terraform apply tfplan
```

Then push to `main`: CI builds, scans, signs, publishes, deploys to development, and waits for reviewers before production canary + post-deployment verification (auto-rollback on failed health check).

### Before the Azure variables are set

CI is designed to be green without a cloud account. Every step that needs Azure
OIDC is guarded by `vars.AZURE_CLIENT_ID != ''`, so until you complete the
bootstrap above these **skip** rather than fail:

- `infrastructure`: remote-backend init, `terraform plan`, plan artifact
- `deploy-dev` and `deploy-production` (the latter also needs `AZURE_PROD_CLIENT_ID`)

Image publication does **not** need Azure: the build job pushes to
`ghcr.io/<repo>/secureflow-api` with the built-in `GITHUB_TOKEN`, and Cosign
signs + attaches the SBOM attestation keyless via GitHub's OIDC identity —
all of it on every `main` push regardless of cloud variables. The first push
creates the GHCR package **private**; flip it to public in the package
settings so Container Apps can pull without registry credentials (the
Terraform deliberately configures none).

What still runs on every push, with no credentials: lint, typecheck, vitest,
pytest, gitleaks, `pnpm audit`, the Playwright HTTP smoke suite, the container
build (which builds the SPA in its own stage), the Trivy image scan, SBOM
generation, `terraform fmt`, `terraform validate`, and Checkov. Setting the
variables activates the skipped steps with no workflow edit.

## Database

`DATABASE_URL` will flow Key Vault → Container App secret → env var, using
password auth (Terraform wiring not yet in place; the module generates the
admin password but does not yet store it in Key Vault or inject it into the
Container App); a managed-identity/Entra token in place of the password is a
later change. Alembic migrations run at app startup (FastAPI lifespan,
under an advisory lock), not as a separate deploy step — one code path
covers local dev, CI, and the container.

`infrastructure/modules/postgres` honors the `enable_private_networking`
gate like the rest of the footprint: with the gate on (staging/prod) it uses
a delegated subnet + private DNS with public access off; with it off (dev)
it exposes a public endpoint to keep the environment cheap.

## Environment separation

- Separate tfvars + state keys per environment; production ideally a separate subscription with its own OIDC identity (`AZURE_PROD_*` variables).
- Version pinning: azurerm `~> 4.14`, Terraform `>= 1.9`; bump deliberately via PR.
- Mandatory tags validated in the resource-group module.

## Rollback

- **App:** previous Container App revision is retained; the prod job auto-activates it if post-deployment verification fails. Manual: `az containerapp revision activate`.
- **Infra:** `terraform plan` against the previous module versions; state is versioned in the storage account if surgery is needed.
