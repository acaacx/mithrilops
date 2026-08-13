# SPA MSAL Wiring + Real Entra Tenant — Design

Date: 2026-08-14
Status: approved for planning

## Goal

The API already validates Entra ID JWTs and enforces RBAC on every `/api`
route when `AUTH_ENABLED=1` (merged `00bb7d5..dcce0c0`), but the SPA sends no
tokens — enabling enforcement today breaks the SPA. This work wires MSAL into
the SPA so it signs in against a real Entra tenant, attaches bearer tokens to
every API call (including SSE), and derives the user's identity and roles from
the token. It also provisions the tenant-side app registration via terraform.

Demo posture is unchanged: with auth off, the SPA behaves exactly as today
(role switcher, "Rowan Ashford", no MSAL code loaded).

## Decisions (settled during brainstorming — do not relitigate)

- **Tenant setup via terraform `azuread` provider**, not portal docs.
- **Single app registration**: SPA platform + exposed API scope + app roles on
  one registration. Token `aud` = client ID, which is exactly what
  `dependencies.py` already validates. One `ENTRA_CLIENT_ID` everywhere.
- **Runtime `/api/config`** tells the SPA whether auth is on and supplies
  tenant/client IDs. One container image works in all modes; server env is the
  single source of truth. No `VITE_` auth vars.
- **Redirect flow** (`loginRedirect`), not popup.
- **SSE keeps native `EventSource`** with `?access_token=` — the server was
  built for this and it is the only route accepting a query token.
- **Auth mode hides the role switcher**; roles come from the token's `roles`
  claim. No read-only switcher, no client-side role override.
- **`@azure/msal-browser` only** (no `msal-react`): imperative singleton
  module, lazy-imported so demo mode never loads MSAL.

## Architecture

### SPA auth module — `apps/web/src/lib/auth/`

Owns one `PublicClientApplication`. Public surface:

- `initAuth(config): Promise<AuthResult>` — constructs MSAL, runs
  `handleRedirectPromise()`, triggers `loginRedirect` if no account, returns
  account (name + roles) when signed in.
- `getAccessToken(): Promise<string | null>` — `acquireTokenSilent` for the
  app's own scope (`api://<clientId>/access`); on
  `InteractionRequiredAuthError`, `acquireTokenRedirect`. Returns `null` in
  demo mode without touching MSAL.
- `signOut(): Promise<void>` — `logoutRedirect`.

The module is lazy-imported (`await import(...)`) only when `/api/config`
reports `authEnabled: true`, so the demo bundle cost is ~0.

### Bootstrap — `main.tsx`

1. `fetch("/api/config")` before `createRoot`.
2. `authEnabled: false` → render exactly as today.
3. `authEnabled: true` → lazy-import auth module, `initAuth`, populate the
   session store from ID token claims (`name`, `roles`), then render.
4. Config fetch failure or MSAL init failure → error splash, **fail closed**.
   Never silently fall back to demo mode: that would mask misconfiguration.

### Token attach — `lib/providers/http.ts`

`api()` asks the auth module for a token; non-null → set
`Authorization: Bearer <token>`. On a 401 response after a silent acquire, one
retry via `acquireTokenRedirect` (covers revocation/expiry mid-session). Demo
mode: `getAccessToken()` short-circuits to `null`; behavior byte-identical to
today.

### SSE — `lib/realtime/sse-client.ts`

Auth mode: fetch a fresh token, open
`EventSource("/api/events?access_token=<token>")`. Native reconnect would
reuse the stale URL, so auth mode uses a small manual reconnect wrapper: on
`error`/close, re-acquire a token and construct a new `EventSource`. Demo mode
keeps today's native behavior untouched.

### Session store — `stores/session.ts`

- `role: Role` → `roles: Role[]`. Demo default `["devsecops-engineer"]`; the
  switcher sets a single-element array. Auth mode sets the token's roles.
- `useCan` unions permissions across roles — mirroring the server's
  `permissions_for(roles)` union semantics.
- New `authMode: boolean`. When true the role switcher is hidden and a
  sign-out menu item appears; `userName` comes from the token.
- `lib/rbac.ts` grows a roles-array helper backed by the same canonical
  `packages/types/src/role-permissions.json`.

### API — `GET /api/config`

Unauthenticated (joins `/health` in the open list; route-coverage test gains
one exemption). Returns `{"authEnabled": bool, "tenantId": str,
"clientId": str}` from the existing `AuthConfig`. Tenant/client IDs are public
in any SPA flow (they appear in the redirect URL); no secret is exposed.
Read-only route — no commit-before-return needed.

### Terraform — `infrastructure/modules/entra-app/`

- Adds the `azuread` provider (module + env backends).
- One `azuread_application`:
  - SPA platform redirect URIs: the app's own origin + `http://localhost:5173`.
  - Exposed OAuth2 scope `access`; `accessTokenAcceptedVersion = 2`.
  - Eight app roles, values verbatim from the canonical JSON: `developer`,
    `devsecops-engineer`, `security-engineer`, `platform-engineer`,
    `application-owner`, `compliance-reviewer`, `release-approver`,
    `administrator`.
- `azuread_service_principal` for the app (required for role assignment).
- **User→role assignment is out of scope** — done per-person in the portal.
- Container-apps module: new `auth_enabled` variable, default `false` (demo
  posture preserved; same gate pattern as `enable_private_networking`). When
  true, injects `AUTH_ENABLED=1`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID` from
  module outputs.

## Testing

- **Web (vitest)**: auth module with `@azure/msal-browser` mocked; token
  attach in `http.test.ts`; roles-union `useCan`; SSE URL construction +
  reconnect token refresh. Memory-mode tests untouched (auth module never
  loads).
- **API (pytest)**: `/api/config` shape in both modes; open-route exemption in
  the route-coverage test.
- **Terraform**: existing `terraform validate` CI job covers the new module.
- **Real-tenant E2E**: manual verification only — no tenant creds in CI.

## Error handling summary

| Failure | Behavior |
| --- | --- |
| `/api/config` unreachable | Error splash, fail closed |
| MSAL init/redirect error | Error splash, fail closed |
| Silent token acquire fails | `acquireTokenRedirect` |
| API returns 401 in auth mode | One redirect-based re-auth attempt |
| SSE stream drops in auth mode | Fresh token, new `EventSource` |
| Token has no known roles | Signed in, zero permissions (server ignores unknown roles; SPA mirrors) |

## Out of scope

- User→app-role assignments in terraform.
- msal-react, popup flow, `ssoSilent` optimization.
- Key Vault → `DATABASE_URL` wiring (separate track).
- CI E2E against a live tenant.
