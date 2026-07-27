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
- Logs: redaction requirement documented; Fastify logger must never receive request bodies of auth routes (enforced at the marked auth extension point).
- SPA CSP restricts `connect-src 'self'` — no third-party beacons.

## Denial of service

- API rate limiting (per-IP), Container Apps autoscaling with max caps, Azure Front Door/WAF recommended for the public edge (module included for App Gateway WAF in Prevention mode).

## Elevation of privilege

- Least-privilege role assignments in Terraform (scoped custom roles for CI; `AcrPull`/`Key Vault Secrets User` only for the app identity).
- The seeded finding `find-iam-wide` (subscription-scope Contributor) is the worked example of detecting and remediating this class.
- UI RBAC is advisory; the authoritative check belongs in the API (documented, partially stubbed).

## Top residual risks

1. No real authentication in mock mode ⚠︎ — do not expose beyond localhost.
2. Server-side authorization not yet enforced (scaffold only).
3. Simulated scanners mean no actual vulnerability detection occurs in this build.
