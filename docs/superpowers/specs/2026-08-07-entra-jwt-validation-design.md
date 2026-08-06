# Entra ID JWT Validation + Server-Side RBAC — Design

Date: 2026-08-07
Status: approved

## Goal

Replace the API's no-auth posture with Entra ID (OIDC) bearer-token validation
and server-side role-based permission enforcement, built and tested entirely
against self-signed JWKS fixtures. No real Entra tenant exists yet; tenant and
client IDs come from environment placeholders. This implements the "production
auth plan" in `docs/security-model.md`, with one deviation recorded below.

## Decisions (settled during brainstorming — do not relitigate)

- **Scope:** token validation AND server-side RBAC enforcement. SPA is
  untouched: no MSAL, role switcher stays. Token acquisition is out of scope.
- **Gating:** explicit `AUTH_ENABLED` flag, default off. When on, missing
  config is fatal at startup (fail-fast, no silent misconfig). When off, one
  loud startup log line. Mirrors the `DEMO_RESET_ENABLED` explicit-flag
  precedent.
- **Role claim:** Entra **app roles** (`roles` claim), whose values are the
  `Role` enum strings verbatim (`developer`, `release-approver`, …). Zero
  mapping config. This deviates from security-model.md's original "group
  claims" wording; the doc is updated as part of this work. Groups-claim
  mapping was rejected (GUID map config, 200-group overage edge case).
- **SSE:** `?access_token=` query parameter accepted **only** on
  `/api/events`, validated identically to the header path (RFC 6750 §2.3).
  Token-in-server-logs residual risk goes in the threat model; mitigation is
  short token expiry.
- **Approach:** PyJWT + `PyJWKClient` + FastAPI dependency chain.
  `fastapi-azure-auth` rejected (wants a real tenant's discovery endpoint;
  opaque for a security-showcase repo). ASGI-middleware enforcement rejected
  (fights FastAPI idiom); its "can't forget a route" advantage is recovered by
  a route-coverage test.

## 1. Architecture & module layout

New package `apps/api/src/secureflow_api/auth/`:

| Module | Responsibility |
|---|---|
| `config.py` | `AuthConfig` from env. `AUTH_ENABLED` (default off), `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, optional `ENTRA_JWKS_URL` override. Issuer derived `https://login.microsoftonline.com/{tenant}/v2.0`; JWKS URL default `https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys`. `AUTH_ENABLED=1` + missing tenant/client → raise at startup. |
| `jwks.py` | Thin wrapper over PyJWT's `PyJWKClient` (fetch, cache, `kid` lookup, rotation). Constructor takes the JWKS URL — the fixture seam. Never constructed in disabled mode (no network). |
| `rbac.py` | Python `Permission` type + `ROLE_PERMISSIONS` matrix + `permissions_for(roles) -> set[Permission]` (union across multiple roles). |
| `principal.py` | `Principal` dataclass: `sub`, `name`, `roles: list[Role]`, computed permission set, `require(permission)` raising 403. |
| `dependencies.py` | `get_principal` (extract + validate bearer → `Principal`; disabled mode returns a synthetic administrator principal so permission checks are uniform no-ops in demos) and `require_permission(perm)` dependency factory. |

**Role-matrix drift control:** the matrix becomes canonical JSON at
`packages/types/src/role-permissions.json`. `apps/web/src/lib/rbac.ts` imports
it (behavior unchanged). Python keeps its own dict at runtime; a parity pytest
reads the JSON from the repo and asserts equality. Runtime never reads across
the monorepo — only the test does.

**New dependency:** `pyjwt[crypto]>=2.10` (pulls `cryptography` for RS256).
Nothing else.

## 2. Token validation flow

Token extraction: `Authorization: Bearer <token>` on every route;
`?access_token=` additionally accepted only on `/api/events`.

1. Unverified header parse → `kid` → signing key from cached JWKS client.
2. `jwt.decode` with `algorithms=["RS256"]` pinned (no `none`, no HS
   downgrade), `audience=ENTRA_CLIENT_ID`, `issuer=<derived>`, required claims
   `exp`, `iat`, `sub`, leeway 60s.
3. `roles` claim filtered to known `Role` values. Unknown values ignored with
   a warning log. Zero valid roles → authenticated, permission-less principal
   (every privileged route 403s).
4. Build `Principal`; `name` from `name` claim, then `preferred_username`,
   fallback `sub`.

Error semantics:

- Missing / malformed / expired / bad-signature / wrong-audience /
  wrong-issuer token → **401**, `WWW-Authenticate: Bearer` header, generic
  detail (no claim echo).
- Valid token, insufficient permission → **403**.
- `/health` stays unauthenticated (Container Apps probes).

## 3. RBAC enforcement — route → permission matrix

Route-level via `Depends(require_permission(...))`:

| Route | Permission |
|---|---|
| `POST /api/runs/{id}/stages/{sid}/retry` | `pipeline.retry-stage` |
| `POST /api/applications/{id}/sync` | `pipeline.trigger` |
| `POST /api/applications/{id}/promote` | `deployment.promote` |
| `POST /api/applications/{id}/rollback` | `deployment.rollback` |
| `POST /api/demo/reset` | `settings.manage` (in addition to the existing `DEMO_RESET_ENABLED` fail-closed gate) |
| `POST /api/audit` | any authenticated principal |
| all `GET` routes + `/api/events` | any authenticated principal |

Handler-level (permission depends on the request body):

- `POST /api/runs/{id}/approval` — decision-mapped: `approved` →
  `deployment.approve`, `rejected` → `deployment.reject`,
  `changes-requested` → `deployment.request-changes`. Checked via
  `principal.require(...)` after body parse, before any write.
- `PATCH /api/findings/{id}/status` — `finding.update-status` always; when the
  new status is `risk-accepted`, additionally `risk.accept`.

Behavior touches:

- Approval handler's hardcoded `decided_by = "You"` becomes `principal.name`.
  The synthetic disabled-mode principal carries `name="You"`, so demo output
  is byte-identical with auth off.
- **Route-coverage test:** walks `app.routes`, asserts every `POST`/`PATCH`
  route carries a `require_permission` dependency or appears on an explicit
  allowlist of handler-checked routes (`approval`, `findings status`,
  `audit`). A new unprotected mutating route is a CI failure.

Judgment call (flagged and accepted): `sync` maps to `pipeline.trigger` — it
kicks GitOps reconciliation, the closest existing permission.
`integration.manage` was the alternative.

## 4. Testing, CI, docs

**Fixtures** (`apps/api/tests/conftest.py` additions):

- Session-scoped RSA keypair (`cryptography`).
- JWKS dict from the public key, fixed `kid`.
- Token factory `make_token(roles=[...], aud=..., iss=..., exp=..., key=...)`
  with valid defaults so each test perturbs exactly one thing.
- JWKS client fed the static key set directly (constructed with the fixture,
  no HTTP).

**Test matrix:**

- Happy path: token per role reaches its permitted routes.
- 401 set: missing token, garbage token, expired, wrong audience, wrong
  issuer, signature from a different key, unknown `kid`, tampered `alg`.
- 403 set: role lacking the route permission; zero-valid-roles principal;
  approval decision vs. permission mismatches (each of the three decisions);
  `risk-accepted` status change without `risk.accept`.
- SSE: `?access_token=` accepted on `/api/events`, rejected on any other
  route.
- Disabled mode: routes open, synthetic administrator principal,
  `decided_by == "You"`.
- Fail-fast: `AUTH_ENABLED=1` without tenant/client raises at startup.
- Parity: Python `ROLE_PERMISSIONS` equals `role-permissions.json`.
- Coverage: the route-walk test from §3.

**CI:** no changes — existing pytest job (with Postgres service container)
runs everything.

**Docs:**

- `docs/security-model.md` — "Production auth plan (not yet implemented)"
  rewritten to implemented-with-placeholder-tenant; app-roles deviation noted.
- `docs/deployment.md` — env var table gains `AUTH_ENABLED`,
  `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_JWKS_URL`.
- `docs/threat-model.md` — SSE query-token-in-logs residual risk, short-expiry
  mitigation.

## Out of scope

SPA MSAL wiring, real tenant configuration, token acquisition anywhere, rate
limiting, refresh flows, Key Vault → `DATABASE_URL` wiring (separate open
item).
