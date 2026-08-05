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
| Terraform: private endpoints, deny-by-default ACLs, RBAC Key Vault, TLS-only Redis/Postgres/Storage, WORM evidence storage, least-privilege role assignments, mandatory tags | `infrastructure/modules/*` |
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
- Authentication — a role **switcher** stands in for Microsoft Entra ID OIDC. There is no real login; do not deploy this build to an untrusted network without adding it.

## Hard rules encoded

1. **AI never bypasses gates.** No code path lets an `AIRecommendation` change a stage status, approval, or gate result; unit tests assert blocked runs are never reported safe.
2. **Human approval is a GitHub `environment` reviewer gate** in CI — outside the reach of the application entirely.
3. **Evidence is append-only**: WORM storage policy (400 days) in Terraform; audit log has no delete path.

## Production auth plan (not yet implemented)

Entra ID OIDC (auth code + PKCE) in the SPA → access token → API validates issuer/audience/signature, maps group claims to the same `Role` enum, enforces `ROLE_PERMISSIONS` server-side on every privileged route. The UI matrix is a usability layer only; the API check is authoritative.
