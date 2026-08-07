# Threat model (STRIDE summary)

Scope: the deployed platform (SPA + API + Azure infra + CI pipeline). Mock-mode-only risks are marked ⚠︎.

## Assets

Release approval authority · pipeline evidence & audit trail · scanner findings · Terraform state · signing identity (Cosign/OIDC) · Key Vault contents · customer-facing availability of governed apps.

## Spoofing

- **CI identity theft** → mitigated: OIDC federation scoped to `repo:…:environment:<env>`; no long-lived secrets to steal.
- **User impersonation** ⚠︎ → open in mock mode (role switcher). Mitigation on the roadmap: Entra ID OIDC + server-side authz (docs/security-model.md).

## Tampering

- **Image tampering** → Cosign keyless signing + `cosign verify` gate before production; ACR content trust.
- **Terraform state tampering** → remote state with Entra-only auth, locking, versioned storage.
- **Evidence tampering** → WORM immutability policy (400 days); SHA-256 manifests surfaced in the UI.
- **PR/pipeline tampering** → branch protection + required reviews + required checks (org policy).

## Repudiation

- Every privileged action (approve, reject, retry, promote, rollback, risk-accept, status change) writes an audit event including denials. API extension point: ship audit writes to Log Analytics with immutable retention.

## Information disclosure

- Private endpoints for all data planes; `public_network_access_enabled = false` everywhere.
- Logs: redaction requirement documented; the API logger must never receive request bodies of auth routes (enforced at the marked auth extension point).
- SPA CSP restricts `connect-src 'self'` — no third-party beacons.

## Denial of service

- API rate limiting (per-IP), Container Apps autoscaling with max caps, Azure Front Door/WAF recommended for the public edge (no WAF module in this repo yet — add one before real exposure).

## Elevation of privilege

- Least-privilege role assignments in Terraform (scoped custom roles for CI; `AcrPull`/`Key Vault Secrets User` only for the app identity).
- The seeded finding `find-iam-wide` (subscription-scope Contributor) is the worked example of detecting and remediating this class.
- UI RBAC is advisory; the authoritative check is the API's server-side `ROLE_PERMISSIONS` enforcement (`apps/api/src/secureflow_api/auth/`), active when `AUTH_ENABLED=1`. A route-coverage test fails CI on any unprotected mutating route.

## Top residual risks

1. Auth is off by default (`AUTH_ENABLED=0`) and no real Entra tenant is configured ⚠︎ — with the flag off, do not expose beyond localhost. JWT validation + server-side RBAC are implemented and tested, but the SPA acquires no tokens yet, so enforcement cannot be turned on end-to-end until MSAL wiring and a real tenant land.
2. SSE query token: `/api/events` accepts `?access_token=` because EventSource cannot send headers (RFC 6750 §2.3). The token can land in access logs of intermediaries. Accepted: token lifetime is short (Entra default ~1h), transport is TLS-only, the API itself does not log query strings, and the endpoint is read-only event notifications. The parameter is rejected on every other route.
3. Simulated scanners mean no actual vulnerability detection occurs in this build.
