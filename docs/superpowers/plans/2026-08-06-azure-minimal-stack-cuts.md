# Azure Minimal-Stack Cuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Azure footprint decisions of 2026-08-02: delete the acr/redis/static-web-app Terraform modules, trim monitoring to Log Analytics only, gate private networking behind a variable, move CI image publication from ACR to GHCR, and serve the built SPA from FastAPI.

**Architecture:** The SPA becomes a directory of static files mounted into the existing FastAPI app (same-origin, no Static Web App). The container image gains a Node build stage that produces `apps/web/dist` and ships it. CI pushes to `ghcr.io/<repo>/secureflow-api` using the built-in `GITHUB_TOKEN` — no Azure credential needed to publish, sign, or attest; only the deploy jobs stay Azure-gated. Terraform keeps the network module (VNets are free) but every private endpoint / VNet-integration becomes conditional on `enable_private_networking` (dev off, staging/prod on).

**Tech Stack:** FastAPI + Starlette StaticFiles, Docker multi-stage (node:22 + uv), Terraform azurerm ~> 4.14, GitHub Actions, Cosign keyless, GHCR.

## Global Constraints

- Decisions in `~/.claude/.../memory/azure-minimal-stack-decision.md` are final: Azure-only, no Redis anywhere, ACR → GHCR, Entra placeholder auth. Do not relitigate.
- `setup-uv@v9.0.0` and `cosign-installer@v4.1.2` stay pinned exactly (no floating tags exist).
- Security gates (Trivy, Checkov, Gitleaks, audit) must never become conditional on cloud access.
- All three `infrastructure/environments/{dev,staging,prod}/main.tf` are byte-identical today and must stay identical after edits (only `terraform.tfvars` differs).
- Terraform must pass `terraform fmt -recursive -check` and per-env `terraform init -backend=false && terraform validate`.
- API tests require a local Postgres: `docker compose up -d` first; pytest env `TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/secureflow_test` if conftest needs it (mirror `.github/workflows/ci.yml:57`).
- GHCR image name must be lowercase: compute with `${GITHUB_REPOSITORY,,}` in bash.
- Commit after each task. Do not push until the final task.

---

### Task 1: FastAPI serves the built SPA

**Files:**
- Create: `apps/api/src/secureflow_api/spa.py`
- Create: `apps/api/tests/test_spa.py`
- Modify: `apps/api/src/secureflow_api/main.py` (imports around line 20–30; wiring after the last route, before the `run` entrypoint at ~line 455)

**Interfaces:**
- Produces: `mount_spa(app: FastAPI, dist: Path) -> None` — mounts `/assets` and a catch-all GET that serves `index.html` for client-routed paths. Activated in `main.py` only when env `WEB_DIST_DIR` is set (Task 2 sets it in the image; local dev keeps using Vite on 5173, so behavior without the env var is unchanged).
- Consumes: existing `app` object in `main.py`; all API routes live under `/api/*` plus `/health`.

- [ ] **Step 1: Write the failing tests**

```python
# apps/api/tests/test_spa.py
"""Same-origin SPA serving (replaces the Azure Static Web App)."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from secureflow_api.spa import mount_spa


def make_client(tmp_path: Path) -> tuple[TestClient, str]:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    index_html = "<html><body>secureflow spa</body></html>"
    (dist / "index.html").write_text(index_html)
    (dist / "assets" / "app.js").write_text("console.log('app')")
    (dist / "favicon.svg").write_text("<svg/>")
    (tmp_path / "outside.txt").write_text("secret")

    app = FastAPI()

    @app.get("/api/ping")
    async def ping() -> dict[str, bool]:
        return {"ok": True}

    mount_spa(app, dist)
    return TestClient(app), index_html


def test_root_serves_index(tmp_path: Path) -> None:
    client, index_html = make_client(tmp_path)
    res = client.get("/")
    assert res.status_code == 200
    assert res.text == index_html


def test_deep_link_falls_back_to_index(tmp_path: Path) -> None:
    client, index_html = make_client(tmp_path)
    res = client.get("/applications/app-1/runs")
    assert res.status_code == 200
    assert res.text == index_html


def test_asset_is_served(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)
    res = client.get("/assets/app.js")
    assert res.status_code == 200
    assert "console.log" in res.text


def test_top_level_file_is_served(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)
    res = client.get("/favicon.svg")
    assert res.status_code == 200
    assert res.text == "<svg/>"


def test_api_routes_still_win(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)
    assert client.get("/api/ping").json() == {"ok": True}


def test_unknown_api_path_is_404_not_index(tmp_path: Path) -> None:
    client, _ = make_client(tmp_path)
    assert client.get("/api/nope").status_code == 404


def test_traversal_cannot_escape_dist(tmp_path: Path) -> None:
    client, index_html = make_client(tmp_path)
    res = client.get("/..%2Foutside.txt")
    # Whatever the URL normalization does, the file outside dist must not leak.
    assert res.status_code in (200, 404)
    assert res.text != "secret"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_spa.py -v`
Expected: FAIL/ERROR with `ModuleNotFoundError: No module named 'secureflow_api.spa'`
(If conftest demands a database, run `docker compose up -d` first and export `TEST_DATABASE_URL` as in Global Constraints.)

- [ ] **Step 3: Implement `spa.py`**

```python
# apps/api/src/secureflow_api/spa.py
"""Serve the built SPA from the API process (same-origin; no Static Web App)."""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


def mount_spa(app: FastAPI, dist: Path) -> None:
    dist = dist.resolve()
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str) -> FileResponse:
        # Unknown API paths must surface as errors, not silently return HTML.
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        candidate = (dist / full_path).resolve()
        if full_path and candidate.is_file() and candidate.is_relative_to(dist):
            return FileResponse(candidate)
        return FileResponse(dist / "index.html")
```

- [ ] **Step 4: Wire into `main.py`**

Add to the imports block (near `from .simulator import run_simulator`):

```python
from pathlib import Path

from .spa import mount_spa
```

Add at the end of the route definitions, immediately before the `run` entrypoint function (the catch-all must be registered after every API route):

```python
# SPA hosting: set WEB_DIST_DIR (the container image does) to serve the built
# frontend same-origin. Local dev leaves it unset and uses Vite on :5173.
_web_dist = os.environ.get("WEB_DIST_DIR")
if _web_dist:
    mount_spa(app, Path(_web_dist))
```

Also update the module docstring's stale extension-point line — replace

```
- Events: fan out real events from Redis pub/sub instead of the heartbeat timer.
```

with

```
- Events: fan out cross-instance events via Postgres LISTEN/NOTIFY if the
  in-process SSE broadcast ever needs to span replicas (Redis was cut).
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_spa.py -v`
Expected: 7 passed

- [ ] **Step 6: Run the full API suite to catch regressions**

Run: `uv run --package secureflow-api pytest apps/api/tests`
Expected: all pass (WEB_DIST_DIR is unset in tests, so the catch-all is never mounted on the real app).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/secureflow_api/spa.py apps/api/tests/test_spa.py apps/api/src/secureflow_api/main.py
git commit -m "feat(api): serve the built SPA same-origin via WEB_DIST_DIR"
```

---

### Task 2: Ship the SPA in the container image

**Files:**
- Modify: `docker/Dockerfile.api`

**Interfaces:**
- Consumes: `WEB_DIST_DIR` behavior from Task 1.
- Produces: an image that serves `/` (SPA) and `/api/*` from one origin on port 4000. CI (Task 5) can then drop its separate frontend-build step.

- [ ] **Step 1: Add a web build stage and ship dist**

Replace the full contents of `docker/Dockerfile.api` with:

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS web
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile && pnpm --filter @secureflow/web build

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS deps
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
# Dependency layer first — cached until the lockfile changes.
COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/
RUN uv sync --locked --no-dev --no-install-workspace --package secureflow-api
COPY apps/api ./apps/api
RUN uv sync --locked --no-dev --package secureflow-api

FROM python:3.13-slim AS runtime
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" API_HOST=0.0.0.0 WEB_DIST_DIR=/app/web-dist
COPY --from=deps /app/.venv ./.venv
COPY --from=deps /app/apps/api ./apps/api
COPY --from=web /app/apps/web/dist ./web-dist

# Never run as root; drop privileges to a dedicated user.
RUN groupadd -g 10001 app && useradd -m -u 10001 -g app app
USER app

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:4000/health')" || exit 1
CMD ["secureflow-api"]
```

- [ ] **Step 2: Build the image locally**

Run: `docker build -f docker/Dockerfile.api -t secureflow-api:spa-test .`
Expected: builds clean. If `pnpm install` fails because a workspace package the web app needs is missing from the copied set, add the missing `COPY` (the workspace globs live in `pnpm-workspace.yaml`) rather than loosening `--frozen-lockfile`.

- [ ] **Step 3: Smoke-test SPA + API from the container**

```bash
docker compose up -d
docker run --rm -d --name spa-smoke --network host \
  -e DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/secureflow \
  secureflow-api:spa-test
sleep 5
curl -fsS http://localhost:4000/health
curl -fsS http://localhost:4000/ | grep -qi '<html'
curl -fsS http://localhost:4000/applications | grep -qi '<html'
docker rm -f spa-smoke
```

(Adjust `DATABASE_URL` credentials/db name to match the root `docker-compose.yml` if they differ.)
Expected: health OK, `/` and a deep link both return HTML.

- [ ] **Step 4: Commit**

```bash
git add docker/Dockerfile.api
git commit -m "feat(docker): build and ship the SPA in the API image"
```

---

### Task 3: Delete acr/redis/static-web-app modules, trim monitoring

**Files:**
- Delete: `infrastructure/modules/acr/`, `infrastructure/modules/redis/`, `infrastructure/modules/static-web-app/`
- Modify: `infrastructure/modules/monitoring/main.tf`
- Modify: `infrastructure/modules/network/main.tf` (DNS zone set, lines 69–80)
- Modify: `infrastructure/modules/container-apps/main.tf` (drop registry/acr var, stale NODE_ENV)
- Modify: `infrastructure/environments/{dev,staging,prod}/main.tf` (identically)
- Modify: `infrastructure/environments/{dev,staging,prod}/variables.tf` (identically)
- Modify: `infrastructure/environments/{dev,staging,prod}/terraform.tfvars`

**Interfaces:**
- Produces: monitoring module exposing only `workspace_id`; container-apps module without `acr_login_server`/`registry`; env roots with no acr/redis/static_web_app module blocks. Task 4 builds on these exact files.

- [ ] **Step 1: Delete the three modules**

```bash
git rm -r infrastructure/modules/acr infrastructure/modules/redis infrastructure/modules/static-web-app
```

- [ ] **Step 2: Trim monitoring to Log Analytics only**

Replace `infrastructure/modules/monitoring/main.tf` contents with:

```hcl
terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.14"
    }
  }
}

variable "name_prefix" { type = string }
variable "resource_group_name" { type = string }
variable "location" { type = string }
variable "tags" { type = map(string) }

resource "azurerm_log_analytics_workspace" "this" {
  name                = "log-${var.name_prefix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = "PerGB2018"
  retention_in_days   = 90
  tags                = var.tags
}

output "workspace_id" { value = azurerm_log_analytics_workspace.this.id }
```

(App Insights, the action group, and the metric alert are cut; Container Apps logs land in this workspace.)

- [ ] **Step 3: Drop redis/acr private DNS zones from the network module**

In `infrastructure/modules/network/main.tf`, shrink the zone set to:

```hcl
resource "azurerm_private_dns_zone" "zones" {
  for_each = toset([
    "privatelink.vaultcore.azure.net",
    "privatelink.postgres.database.azure.com",
    "privatelink.blob.core.windows.net",
  ])
  name                = each.value
  resource_group_name = var.resource_group_name
  tags                = var.tags
}
```

- [ ] **Step 4: Remove ACR coupling and stale env from container-apps**

In `infrastructure/modules/container-apps/main.tf`:
- Delete `variable "acr_login_server" { type = string }`.
- Delete the whole `registry { ... }` block from `azurerm_container_app.api` (images come from public GHCR; a private GHCR package would need a PAT secret — documented in Task 6, deliberately not built).
- Delete the stale Fastify-era env block:

```hcl
      env {
        name  = "NODE_ENV"
        value = "production"
      }
```

- [ ] **Step 5: Rewire the three environment roots (identical edits in dev, staging, prod)**

In each `infrastructure/environments/<env>/main.tf`:
- Delete the `module "acr"`, `module "redis"`, and `module "static_web_app"` blocks entirely.
- Delete the `output "web_hostname"` block.
- In `module "monitoring"`, delete the `alert_email = var.alert_email` line.
- In `module "container_apps"`, delete the `acr_login_server = module.acr.login_server` line.

In each `infrastructure/environments/<env>/variables.tf`: delete the `variable "alert_email"` block.

In each `infrastructure/environments/<env>/terraform.tfvars`: delete the `alert_email` line, and replace the `api_image` value with the GHCR path (repo per `github_repository`):

```hcl
api_image = "ghcr.io/meridian/secureflow-control-center/secureflow-api@sha256:0000000000000000000000000000000000000000000000000000000000000000"
```

- [ ] **Step 6: Validate**

```bash
cd infrastructure && terraform fmt -recursive -check
for e in dev staging prod; do
  (cd environments/$e && terraform init -backend=false -input=false >/dev/null && terraform validate)
done
diff environments/dev/main.tf environments/staging/main.tf && diff environments/staging/main.tf environments/prod/main.tf
```

Expected: fmt clean, three `Success!`, both diffs empty.

- [ ] **Step 7: Commit**

```bash
git add -A infrastructure
git commit -m "infra: cut acr/redis/static-web-app, trim monitoring to log analytics"
```

---

### Task 4: Gate private networking behind `enable_private_networking`

**Files:**
- Modify: `infrastructure/modules/key-vault/main.tf`
- Modify: `infrastructure/modules/postgres/main.tf`
- Modify: `infrastructure/modules/storage/main.tf`
- Modify: `infrastructure/modules/container-apps/main.tf`
- Modify: `infrastructure/environments/{dev,staging,prod}/main.tf` and `variables.tf` (identically)
- Modify: `infrastructure/environments/{dev,staging,prod}/terraform.tfvars`

**Interfaces:**
- Consumes: module shapes after Task 3.
- Produces: every module accepting `enable_private_networking` (bool). Env roots pass `var.enable_private_networking` through. dev=false, staging=true, prod=true.

- [ ] **Step 1: Add the variable to each of the four modules**

Same block in key-vault, postgres, storage, and container-apps `main.tf`:

```hcl
variable "enable_private_networking" {
  description = "Provision private endpoints / VNet integration. Off keeps dev cheap on public endpoints; on for staging and prod."
  type        = bool
  default     = true
}
```

- [ ] **Step 2: key-vault conditionals**

In `azurerm_key_vault.this`:

```hcl
  public_network_access_enabled = !var.enable_private_networking

  network_acls {
    default_action = var.enable_private_networking ? "Deny" : "Allow"
    bypass         = "AzureServices"
  }
```

On `azurerm_private_endpoint.kv`, add as the first line of the block:

```hcl
  count = var.enable_private_networking ? 1 : 0
```

- [ ] **Step 3: postgres conditionals**

In `azurerm_postgresql_flexible_server.this`:

```hcl
  public_network_access_enabled = !var.enable_private_networking
  delegated_subnet_id           = var.enable_private_networking ? var.data_subnet_id : null
  private_dns_zone_id           = var.enable_private_networking ? var.private_dns_zone_id : null
```

- [ ] **Step 4: storage conditionals**

In `azurerm_storage_account.this`:

```hcl
  public_network_access_enabled = !var.enable_private_networking
```

On `azurerm_private_endpoint.blob`, add as the first line of the block:

```hcl
  count = var.enable_private_networking ? 1 : 0
```

- [ ] **Step 5: container-apps conditionals**

In `azurerm_container_app_environment.this`:

```hcl
  infrastructure_subnet_id       = var.enable_private_networking ? var.app_subnet_id : null
  internal_load_balancer_enabled = var.enable_private_networking
```

In the `ingress` block of `azurerm_container_app.api`, replace the `external_enabled` line (and its stale Front Door comment) with:

```hcl
    external_enabled = !var.enable_private_networking # private ingress when the VNet is on
```

- [ ] **Step 6: Env roots (identical edits in dev, staging, prod)**

`variables.tf` — add:

```hcl
variable "enable_private_networking" {
  description = "Private endpoints + VNet integration. Off for dev (cost), on for staging/prod."
  type        = bool
  default     = false
}
```

`main.tf` — add `enable_private_networking = var.enable_private_networking` to the `key_vault`, `postgres`, `storage`, and `container_apps` module blocks.

`terraform.tfvars` — add `enable_private_networking = false` in dev, `= true` in staging and prod.

- [ ] **Step 7: Validate (same commands as Task 3 Step 6)**

Also run Checkov if installed (`checkov -d infrastructure --framework terraform --check HIGH 2>/dev/null || true`); CI runs it authoritatively. If the CI Checkov gate later flags the now-conditional public access as HIGH, add an inline `#checkov:skip=<CHECK_ID>` on the flagged resource with justification `dev-only: gated by enable_private_networking, on in staging/prod` — do not weaken the workflow gate.

- [ ] **Step 8: Commit**

```bash
git add infrastructure
git commit -m "infra: gate private endpoints and vnet integration behind enable_private_networking"
```

---

### Task 5: CI moves from ACR to GHCR

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Dockerfile from Task 2 (builds SPA internally).
- Produces: images at `ghcr.io/<repo-lowercase>/secureflow-api:<sha>`, Cosign-signed with SBOM attestation, published on every main push with zero Azure dependency. Deploy jobs consume `${{ env.IMAGE }}`.

- [ ] **Step 1: Workflow-level changes**

- In the top-level `env:` block, delete both `REGISTRY` and `IMAGE_NAME`.
- Top-level `permissions:` keeps `packages: read` (job-level overrides grant write where needed).

- [ ] **Step 2: Rewrite the build job's image steps**

- Change the build job's `permissions:` entry `packages: read` → `packages: write`.
- Delete the `Frontend build` step (`pnpm --filter @secureflow/web build`) — the Dockerfile builds the SPA now. The pnpm setup steps before it are then unused in this job; delete `pnpm/action-setup`, `setup-node`, and `pnpm install` from the build job too.
- Insert as the first step after checkout:

```yaml
      - name: Compute image ref (GHCR requires lowercase)
        run: echo "IMAGE=ghcr.io/${GITHUB_REPOSITORY,,}/secureflow-api" >> "$GITHUB_ENV"
```

- Replace every `$REGISTRY/$IMAGE_NAME` / `${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}` in the job with `$IMAGE` / `${{ env.IMAGE }}`.
- Replace the `Azure login (OIDC)` + `Push image to ACR` steps with:

```yaml
      - name: Log in to GHCR
        if: github.ref == 'refs/heads/main'
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Push image to GHCR
        if: github.ref == 'refs/heads/main'
        run: docker push $IMAGE:${{ github.sha }}
```

- On the Cosign install, sign, and attest steps, change the condition from
  `github.ref == 'refs/heads/main' && vars.AZURE_CLIENT_ID != ''` to
  `github.ref == 'refs/heads/main'` — signing uses GitHub OIDC keyless identity, not Azure.
- Update the comment above the (deleted) Azure-login step: publication now needs only `GITHUB_TOKEN`; nothing in build/scan/sign/publish depends on cloud vars anymore.

- [ ] **Step 3: Point deploy jobs at GHCR**

In both `deploy-dev` and `deploy-production`, insert the same `Compute image ref` step right after `actions/checkout`, and replace `$REGISTRY/$IMAGE_NAME` with `$IMAGE` in the `az containerapp update`, `cosign verify`, and `az containerapp revision copy` commands. Their Azure gating conditions stay exactly as they are.

- [ ] **Step 4: Sanity checks**

```bash
grep -n "REGISTRY\|azurecr\|acr " .github/workflows/ci.yml
```

Expected: no matches. Then, if `actionlint` is installed, run `actionlint .github/workflows/ci.yml` (expected: clean); otherwise rely on push CI.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: publish images to ghcr, sign without azure dependency"
```

---

### Task 6: Documentation sweep

**Files:**
- Modify: `docs/architecture.md` (lines ~46, 48, 99)
- Modify: `docs/security-model.md` (line ~21)
- Modify: `docs/deployment.md` (the tracked follow-up about the postgres gate)

**Interfaces:** none — prose only.

- [ ] **Step 1: architecture.md**

- In the mermaid diagram: remove the `swa["Static Web App (SPA)"]` node (SPA is served by the Container App) and change the PaaS node text `PostgreSQL · Redis · Key Vault · ACR` to `PostgreSQL · Key Vault · Storage` with a note that private endpoints are gated by `enable_private_networking`.
- Rewrite the stack summary line (~99) to: Container Apps serving API + SPA same-origin, PostgreSQL Flexible Server, Key Vault, Log Analytics, WORM evidence storage, GHCR (public package) for images with Cosign keyless signing; private endpoints/VNet gated by `enable_private_networking` (dev off, staging/prod on). Keep the existing LISTEN/NOTIFY limitation paragraph — it is already correct.

- [ ] **Step 2: security-model.md**

Update the Terraform row (~21): drop `TLS-only Redis`, mention the `enable_private_networking` gate, and add a line that GHCR images are public-by-design for pull-credential-free Container Apps; a private registry would require a PAT in Key Vault (deliberately not built — revisit when the demo hardens).

- [ ] **Step 3: deployment.md**

Find the tracked follow-up note about the postgres module being hard-wired to private networking and rewrite it as resolved: the gate exists, defaults documented (dev off, staging/prod on). Also update any ACR push/pull instructions to GHCR.

- [ ] **Step 4: Verify no stale references remain**

```bash
grep -rni "redis\|azurecr\|static web app\|static-web-app\|app insights" docs/*.md apps/api/src --include="*.py" --include="*.md" | grep -vi "listen/notify\|was cut\|not reintroducing\|redis was"
```

Expected: no hits describing Redis/ACR/SWA as *current* components (historical "was cut" notes are fine — extend the exclusion filter as needed rather than deleting history).

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: minimal stack — ghcr, same-origin spa, private networking gate"
```

---

### Task 7: Final verification and push

- [ ] **Step 1: Full local gates**

```bash
pnpm lint && pnpm typecheck && pnpm test
docker compose up -d
uv run --package secureflow-api pytest apps/api/tests
cd infrastructure && terraform fmt -recursive -check && cd ..
```

Expected: all green.

- [ ] **Step 2: Push and watch CI**

```bash
git push origin main
```

Then poll `gh run watch` / `gh run list --limit 1` until the run completes. Expected green: quality, e2e-http, build (now including GHCR push + Cosign sign on main), infrastructure (fmt/validate/Checkov). `deploy-*` jobs skipped is the intended state. If Checkov fails HIGH on the gated modules, apply the skip-annotation remedy from Task 4 Step 7 and push the fix.

- [ ] **Step 3: Make the GHCR package public**

The first push creates `ghcr.io/<repo>/secureflow-api` as private. Container Apps pulls need it public (no registry credentials configured — by design). This is a GitHub UI action (Package settings → Change visibility) the user must do; surface it as a follow-up, do not attempt it.
