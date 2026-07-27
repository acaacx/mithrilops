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
| No secrets in source control | `.env.example` placeholders only; gitleaks in CI |
| Non-root containers, healthchecks | `docker/Dockerfile.*` |
| CI: secret scan, dependency audit, Trivy, SBOM, Cosign signing, Checkov | `.github/workflows/ci.yml` |
| GitHub → Azure via OIDC federation (no client secrets) | workflow `permissions: id-token: write` + `azurerm use_oidc` |
| Signature verification before production rollout | `cosign verify` step in the prod job |
| Terraform: private endpoints, deny-by-default ACLs, RBAC Key Vault, TLS-only Redis/Postgres/Storage, WORM evidence storage, least-privilege role assignments, mandatory tags | `infrastructure/modules/*` |
| Branch-protection & PR-approval requirements | documented + enforced through the `production` GitHub environment reviewers |

## Simulated (labeled in the UI)

- Scanner findings, Argo CD state, GitHub PR actions, Terraform runs — mock providers.
- AI analysis — deterministic `AIService`; every response carries confidence, evidence, affected assets, risk level, and a human-review disclaimer.
- Authentication — a role **switcher** stands in for Microsoft Entra ID OIDC. There is no real login; do not deploy this build to an untrusted network without adding it.

## Hard rules encoded

1. **AI never bypasses gates.** No code path lets an `AIRecommendation` change a stage status, approval, or gate result; unit tests assert blocked runs are never reported safe.
2. **Human approval is a GitHub `environment` reviewer gate** in CI — outside the reach of the application entirely.
3. **Evidence is append-only**: WORM storage policy (400 days) in Terraform; audit log has no delete path.

## Production auth plan (not yet implemented)

Entra ID OIDC (auth code + PKCE) in the SPA → access token → API validates issuer/audience/signature, maps group claims to the same `Role` enum, enforces `ROLE_PERMISSIONS` server-side on every privileged route. The UI matrix is a usability layer only; the API check is authoritative.
