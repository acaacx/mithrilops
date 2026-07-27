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

## Environment separation

- Separate tfvars + state keys per environment; production ideally a separate subscription with its own OIDC identity (`AZURE_PROD_*` variables).
- Version pinning: azurerm `~> 4.14`, Terraform `>= 1.9`; bump deliberately via PR.
- Mandatory tags validated in the resource-group module.

## Rollback

- **App:** previous Container App revision is retained; the prod job auto-activates it if post-deployment verification fails. Manual: `az containerapp revision activate`.
- **Infra:** `terraform plan` against the previous module versions; state is versioned in the storage account if surgery is needed.
