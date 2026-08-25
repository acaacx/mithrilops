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

`DATABASE_URL` flows Key Vault → Container App secret → env var, using
password auth; a managed-identity/Entra token in place of the password is a
later change. The wiring, end to end:

1. `modules/postgres` generates the admin password (`random_password`, no
   special characters, never in tfvars), creates the `secureflow` database on
   the server, and emits a sensitive `database_url` output of the form
   `postgresql+asyncpg://sfadmin:<pw>@<fqdn>:5432/secureflow?ssl=require`.
2. `modules/key-vault` stores it as the secret **`database-url`**. The apply
   identity (`data.azurerm_client_config.current.object_id`) is granted
   **Key Vault Secrets Officer** to write it; the app's managed identity keeps
   only **Key Vault Secrets User**.
3. `modules/container-apps` declares a container app `secret` block that is a
   *Key Vault reference* — the app identity resolves
   `key_vault_secret_id` at revision start, so the value never lands in the
   container app resource. The reference is **versionless**, so a rotated
   password is picked up without a Terraform-visible revision change.
4. The container gets `DATABASE_URL` via `secret_name = "database-url"`.

`ssl=require` is not optional: the flexible server runs with
`require_secure_transport` on, and asyncpg takes SQLAlchemy's `ssl` query
parameter, not libpq's `sslmode`.

Alembic migrations run at app startup (FastAPI lifespan, under an advisory
lock), not as a separate deploy step — one code path covers local dev, CI, and
the container.

**Rotating the password:** `terraform taint module.postgres.random_password.admin`
then apply. The new value lands in a new secret version and the versionless
reference resolves to it on the next revision restart.

`infrastructure/modules/postgres` honors the `enable_private_networking`
gate like the rest of the footprint: with the gate on (staging/prod) it uses
a delegated subnet + private DNS with public access off; with it off (dev)
it exposes a public endpoint to keep the environment cheap. In that public
mode the module also creates an `AllowAzureServices` firewall rule
(`0.0.0.0`–`0.0.0.0`, Azure's "allow any Azure service" pseudo-range, *not*
`0.0.0.0/0`) — without it the container app, which egresses from an
Azure-owned address, cannot reach the server at all. Private mode creates no
firewall rule.

**First-apply trap:** the Key Vault Secrets Officer assignment and the secret
that depends on it are created in the same apply, and Azure RBAC propagation
lags role creation by up to a few minutes. If the apply fails writing
`database-url` with a 403, re-run `terraform apply` — the second pass
succeeds. Nothing else is needed.

## API environment variables — auth

| Variable | Default | Meaning |
|---|---|---|
| `AUTH_ENABLED` | `0` | `1` enforces bearer-JWT auth and server-side RBAC on every `/api` route and requires the two variables below. Off = demo posture, loud startup warning. |
| `ENTRA_TENANT_ID` | — | Entra tenant GUID. Issuer is derived: `https://login.microsoftonline.com/{tenant}/v2.0`. |
| `ENTRA_CLIENT_ID` | — | Expected JWT audience (the API's app registration / Application ID URI). |
| `ENTRA_JWKS_URL` | derived | Optional override of the signing-keys URL; defaults to the tenant's `discovery/v2.0/keys` endpoint. Used by tests to point at fixtures. |

Startup is fail-fast: `AUTH_ENABLED=1` with `ENTRA_TENANT_ID` or
`ENTRA_CLIENT_ID` unset raises `AuthConfigError` and the process exits —
misconfiguration can never silently serve open routes.

None of these need setting by hand: `auth_enabled = true` in an
environment's tfvars provisions the Entra app registration and injects all
three into the container app on apply (see below).

## Enabling Entra ID sign-in

1. Set `auth_enabled = true` in
   `infrastructure/environments/<env>/terraform.tfvars`.
2. `terraform apply`. This provisions the app registration
   (`infrastructure/modules/entra-app`: SPA platform, exposed `access`
   scope, the eight app roles, and a service principal) and injects
   `AUTH_ENABLED`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID` into the container
   app.
3. Set `spa_redirect_uris = ["https://<api_fqdn>"]` (the `api_fqdn` output)
   in the same tfvars and `terraform apply` again — staging/prod default to
   an empty list, so the registration has no redirect URI until this second
   pass. (`http://localhost:5173` is dev-only, for local development
   against the dev tenant.)
4. Assign users to app roles in the portal: Entra ID → Enterprise
   applications → the app → **Users and groups** → Add user/group.
   Deliberately not in terraform (see `security-model.md`).
5. Verify with an incognito sign-in against the deployed SPA URL: confirm
   redirect to Microsoft login, a successful callback, and role-appropriate
   UI.

## Environment separation

- Separate tfvars + state keys per environment; production ideally a separate subscription with its own OIDC identity (`AZURE_PROD_*` variables).
- Version pinning: azurerm `~> 4.14`, Terraform `>= 1.9`; bump deliberately via PR.
- Mandatory tags validated in the resource-group module.

## Rollback

- **App:** previous Container App revision is retained; the prod job auto-activates it if post-deployment verification fails. Manual: `az containerapp revision activate`.
- **Infra:** `terraform plan` against the previous module versions; state is versioned in the storage account if surgery is needed.
