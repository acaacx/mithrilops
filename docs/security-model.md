# Security model

## Fully implemented in this codebase

| Control | Where |
|---|---|
| Strict TypeScript, no `any` | eslint + tsconfig across workspaces |
| Input validation with zod (web) / Pydantic (api) | approval/risk/generator forms (web), query/params + fixture load (api) |
| RBAC permission matrix gating privileged UI actions | `apps/web/src/lib/rbac.ts`, `useCan()` |
| Audit logging of privileged operations **and RBAC denials** | `auditProvider.record` calls in every mutation |
| Secure HTTP headers + CSP | `docker/nginx.conf` (SPA), security-headers middleware in `apps/api/src/secureflow_api/main.py` (API) |
| Rate limiting | extension point — edge/API gateway in production |
| CORS restricted to the SPA origin | `apps/api/src/secureflow_api/main.py` |
| `POST /api/demo/reset` restores the demo seed; the route returns 404 (endpoint absent) unless `DEMO_RESET_ENABLED=1` is set explicitly — disabled is the default everywhere, including production, so production never advertises the endpoint | `apps/api/src/secureflow_api/main.py` |
| No secrets in source control | `.env.example` placeholders only; gitleaks in CI |
| Non-root containers, healthchecks | `docker/Dockerfile.*` |
| CI: secret scan, dependency audit, Trivy, SBOM, Cosign signing, Checkov | `.github/workflows/ci.yml` |
| Trivy image scan gates the build on **fixable** CRITICAL/HIGH findings | `ignore-unfixed: true` in the build job — see Accepted advisory exceptions |
| GitHub → Azure via OIDC federation (no client secrets) | workflow `permissions: id-token: write` + `azurerm use_oidc` |
| Signature verification before production rollout | `cosign verify` step in the prod job |
| Terraform: private endpoints + deny-by-default ACLs (gated by `enable_private_networking`; on in staging/prod), RBAC Key Vault, TLS-only Postgres/Storage, WORM evidence storage, least-privilege role assignments, mandatory tags | `infrastructure/modules/*` |
| Container images on GHCR are public **by design** so Container Apps pulls need no registry credential; integrity comes from Cosign keyless signatures verified before prod rollout. A private package would need a PAT in Key Vault — deliberately not built; revisit if the demo hardens | `.github/workflows/ci.yml` build job |
| Branch-protection & PR-approval requirements | documented + enforced through the `production` GitHub environment reviewers |

## Accepted advisory exceptions

`pnpm audit --audit-level high` gates CI. Exceptions live in
`pnpm-workspace.yaml` under `auditConfig.ignoreGhsas`, each with a rationale
comment. Current list:

| Advisory | Package | Why accepted |
|---|---|---|
| GHSA-mh99-v99m-4gvg | brace-expansion | Advisory range `<=5.0.7` semver-matches the 1.x line, so the installed `1.1.16` is flagged despite 1.x being fixed in `1.1.12`. Reachable only via `eslint > minimatch@3 > brace-expansion` — a devDependency that never ships in a container. |
| GHSA-qwww-vcr4-c8h2 | react-router | CSRF bypass in the **RSC mode** server action handler. This app is a declarative `BrowserRouter` SPA — no RSC, no server rendering, no router actions — so the vulnerable code path is not in the bundle. Range is `>=7.12.0 <8.3.0`; the fix, react-router 8, requires React 19.2.7+ and Vite 7+, which this app is not on. Revisit with the React 19 / Vite 7 upgrade. |

Trivy image findings are **not** in GitHub code scanning: that API needs
GitHub Advanced Security, which is not enabled on this private repo. The SARIF
is published as the `trivy-results-sarif` workflow artifact instead, and the
code-scanning upload stays in the workflow as `continue-on-error` so it starts
working the moment GHAS is enabled.

Those three moderate advisories (GHSA-wrjc-x8rr-h8h6, GHSA-337j-9hxr-rhxg on
react-router; GHSA-jjmj-jmhj-qwj2 on react-router-dom) are now **fixed** —
the app moved to `react-router@7.18.2` and dropped `react-router-dom`. No
moderate advisories remain.

## Simulated (labeled in the UI)

- Scanner findings, Argo CD state, GitHub PR actions, Terraform runs — mock providers.
- AI analysis — deterministic `AIService`; every response carries confidence, evidence, affected assets, risk level, and a human-review disclaimer.
- Authentication — demo posture only: a role **switcher** stands in for sign-in when `AUTH_ENABLED=0`, the default everywhere including production. Real Microsoft Entra ID sign-in (MSAL redirect flow, wired end-to-end) turns on with `AUTH_ENABLED=1` plus a provisioned tenant — see API auth below.

## Hard rules encoded

1. **AI never bypasses gates.** No code path lets an `AIRecommendation` change a stage status, approval, or gate result; unit tests assert blocked runs are never reported safe.
2. **Human approval is a GitHub `environment` reviewer gate** in CI — outside the reach of the application entirely.
3. **Evidence is append-only**: WORM storage policy (400 days) in Terraform; audit log has no delete path.

## API auth: implemented, off by default

Bearer JWT validation (Entra ID shape) and server-side RBAC are implemented in
`apps/api/src/secureflow_api/auth/`, gated behind `AUTH_ENABLED` (default `0`
so the demo posture is unchanged; startup logs a loud warning when off).

- **Validation:** PyJWT + cached `PyJWKClient`. Algorithms pinned to `RS256`;
  audience = `ENTRA_CLIENT_ID`; issuer derived from `ENTRA_TENANT_ID`;
  required claims `exp`/`iat`/`sub`, 60s leeway. Token problems → 401 with
  `WWW-Authenticate: Bearer` and a generic detail; permission problems → 403.
  `/health` stays unauthenticated (Container Apps probes).
- **Roles:** the token's Entra **app roles** (`roles` claim) carry `Role` enum
  strings verbatim — a deviation from this doc's original group-claims plan
  (group→role mapping was rejected: GUID map config plus the 200-group overage
  edge case). Unknown role values are ignored with a warning; zero valid roles
  means authenticated but permission-less.
- **RBAC:** `ROLE_PERMISSIONS` is enforced server-side on every `/api` route —
  route-level `require_permission(...)` dependencies, plus handler checks where
  the permission depends on the body (approval decisions, `accepted-risk`).
  A route-coverage test walks `app.routes` and fails CI on any unauthenticated
  or permission-less mutating route. The UI matrix is a usability layer only;
  the API check is authoritative.
- **SSE:** `?access_token=` is accepted on `/api/events` only (EventSource
  cannot set headers; RFC 6750 §2.3). In auth mode the SPA re-acquires a
  fresh token and opens a new `EventSource` on drop instead of relying on
  native reconnect, which would replay the stale token in the URL. Residual
  risk in `threat-model.md`.
- **SPA wiring:** the SPA reads `GET /api/config` at bootstrap — an open
  route alongside `/health`; tenant/client IDs are not secret, they appear in
  the redirect URL of any OIDC flow. `authEnabled: false` renders the demo UI
  unchanged, role switcher and all, and never loads MSAL. `authEnabled: true`
  lazy-loads `@azure/msal-browser` and runs a `loginRedirect` sign-in: the
  role switcher is hidden, roles come straight from the token's app-role
  claims, and `useCan` unions permissions across roles client-side —
  mirroring, not replacing, the server's `permissions_for` check, which
  stays authoritative. A config-fetch or MSAL-init failure renders an error
  splash; there is no silent fallback to demo mode, since that would mask
  misconfiguration as a working demo.
- **Tenant:** pytest validation runs against self-signed JWKS fixtures; a
  real tenant is provisioned via terraform `infrastructure/modules/entra-app`
  — one `azuread_application` covering the SPA redirect URIs, the exposed
  `access` scope, and the eight app roles, plus its service principal.
  Setting `auth_enabled = true` at the environment level (off by default)
  provisions the registration and injects `AUTH_ENABLED`, `ENTRA_TENANT_ID`,
  and `ENTRA_CLIENT_ID` into the container app automatically. User→role
  assignment happens per-person in the Entra portal (Enterprise application →
  Users and groups), not in terraform.
