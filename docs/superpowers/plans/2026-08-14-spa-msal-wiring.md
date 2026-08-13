# SPA MSAL Wiring + Entra Tenant Terraform — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The SPA signs in against a real Entra ID tenant, attaches bearer tokens to every API call (including SSE), derives identity + roles from the token, and terraform provisions the tenant-side app registration — while demo mode stays byte-identical to today.

**Architecture:** Runtime `GET /api/config` tells the SPA whether auth is on. When on, a lazy-loaded `@azure/msal-browser` singleton handles redirect sign-in and token acquisition; a tiny token-registry module (no MSAL import) lets `http.ts`/`sse-client.ts` fetch tokens without bundling MSAL into the demo path. Session store migrates from single `role` to `roles: Role[]` with union permission semantics mirroring the server. Terraform gains an `entra-app` module (single app registration: SPA platform + exposed scope + 8 app roles) gated behind `auth_enabled` (default off).

**Tech Stack:** React 18 + Vite + zustand + vitest (web), FastAPI + pytest (api), Terraform azurerm/azuread (infra).

**Spec:** `docs/superpowers/specs/2026-08-14-spa-msal-wiring-design.md`

## Global Constraints

- Demo posture unchanged: `AUTH_ENABLED` defaults off server-side; terraform `auth_enabled` defaults `false`; demo SPA behavior byte-identical (role switcher, "Rowan Ashford").
- Fail closed: config-fetch or MSAL init failure renders an error splash, never silent demo fallback.
- MSAL loads only in auth mode (dynamic `import()`); `http.ts` and `sse-client.ts` must never import `@azure/msal-browser` statically.
- Token `aud` = client ID; scope is `api://<clientId>/access`; server code (`dependencies.py`) is NOT modified.
- App-role values verbatim from `packages/types/src/role-permissions.json`: `developer`, `devsecops-engineer`, `security-engineer`, `platform-engineer`, `application-owner`, `compliance-reviewer`, `release-approver`, `administrator`.
- Repo conventions: mutating API handlers commit before returning (N/A here — `/api/config` is read-only); terraform gate pattern follows `enable_private_networking`.
- Run web commands from `apps/web` (`pnpm test`, `pnpm lint`, `pnpm typecheck`); API tests from `apps/api` (`uv run pytest`). Terraform fmt: `terraform fmt -recursive` from `infrastructure/`.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `GET /api/config` open route

**Files:**
- Modify: `apps/api/src/secureflow_api/main.py` (add route after `/health`, ~line 112)
- Test: `apps/api/tests/test_auth_routes.py`

**Interfaces:**
- Produces: `GET /api/config` → `{"authEnabled": bool, "tenantId": str, "clientId": str}`, no auth dependency. Task 4's `fetchRuntimeConfig` consumes this shape.

- [ ] **Step 1: Write the failing tests**

In `apps/api/tests/test_auth_routes.py`, add a module constant near `HANDLER_CHECKED` (top of file):

```python
# Routes that are open by design: the SPA must read auth configuration before
# it can acquire a token. Tenant/client IDs are public in any SPA flow.
OPEN_API_ROUTES = {"/api/config"}
```

Modify `test_every_api_route_authenticates` to skip them:

```python
def test_every_api_route_authenticates():
    for route in _api_routes():
        if route.path in OPEN_API_ROUTES:
            continue
        calls = _auth_calls(route)
        assert any(
            c in (authdeps.get_principal, authdeps.get_principal_sse)
            or getattr(c, "required_permission", None)
            for c in calls
        ), f"unauthenticated route: {route.path}"
```

Add after `test_health_stays_open`:

```python
def test_config_stays_open():
    route = next(
        r for r in app.routes if isinstance(r, APIRoute) and r.path == "/api/config"
    )
    assert not _auth_calls(route)


async def test_config_disabled_mode(client):
    response = await client.get("/api/config")
    assert response.status_code == 200
    assert response.json() == {"authEnabled": False, "tenantId": "", "clientId": ""}


async def test_config_enabled_mode(auth_enabled, client):
    body = (await client.get("/api/config")).json()
    assert body["authEnabled"] is True
    assert body["tenantId"] != "" and body["clientId"] != ""
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `apps/api`): `uv run pytest tests/test_auth_routes.py -k config -v`
Expected: FAIL — `StopIteration` on `test_config_stays_open` (route missing), 404s on the mode tests.

- [ ] **Step 3: Implement the route**

In `apps/api/src/secureflow_api/main.py`, directly after the `health` handler (~line 112):

```python
@app.get("/api/config")
async def get_config() -> dict[str, object]:
    # Open by design: the SPA needs this before it can acquire a token.
    # Tenant/client IDs are public values in any SPA flow.
    config = load_auth_config()
    return {
        "authEnabled": config.enabled,
        "tenantId": config.tenant_id,
        "clientId": config.client_id,
    }
```

Add the import at the top of `main.py` alongside the existing auth imports (line 27 already imports from `.auth.dependencies`):

```python
from .auth.config import load_auth_config
```

- [ ] **Step 4: Run the full API suite**

Run: `uv run pytest`
Expected: all pass (104 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/secureflow_api/main.py apps/api/tests/test_auth_routes.py
git commit -m "feat(api): open /api/config route exposing runtime auth config"
```

---

### Task 2: Roles-union RBAC + session store migration

**Files:**
- Modify: `apps/web/src/lib/rbac.ts`
- Modify: `apps/web/src/stores/session.ts`
- Test: `apps/web/src/lib/rbac.test.ts`, Create: `apps/web/src/stores/session.test.ts`

**Interfaces:**
- Consumes: existing `hasPermission(role, permission)` and canonical JSON matrix.
- Produces:
  - `rbac.ts`: `rolesHavePermission(roles: Role[], permission: Permission): boolean`
  - `session.ts` state: `roles: Role[]` (replaces `role`), `authMode: boolean`, `setAuthSession(userName: string, roles: Role[]): void`; `setRole(role)` keeps its name and sets `[role]`. `useCan` unchanged signature.
  - Tasks 3 and 7 rely on exactly these names.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/lib/rbac.test.ts`:

```ts
import { rolesHavePermission } from "./rbac";

describe("rolesHavePermission", () => {
  it("unions permissions across roles like the server", () => {
    // developer alone cannot approve; release-approver can.
    expect(rolesHavePermission(["developer"], "deployment.approve")).toBe(false);
    expect(rolesHavePermission(["developer", "release-approver"], "deployment.approve")).toBe(true);
  });

  it("returns false for an empty roles array", () => {
    expect(rolesHavePermission([], "audit.view")).toBe(false);
  });
});
```

(Adjust the import to merge with the file's existing import from `./rbac`.)

Create `apps/web/src/stores/session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { useSession } from "./session";

describe("session store", () => {
  it("defaults to demo mode with a single role", () => {
    const s = useSession.getState();
    expect(s.roles).toEqual(["devsecops-engineer"]);
    expect(s.authMode).toBe(false);
    expect(s.userName).toBe("Rowan Ashford");
  });

  it("setRole replaces the roles array (demo switcher)", () => {
    useSession.getState().setRole("release-approver");
    expect(useSession.getState().roles).toEqual(["release-approver"]);
  });

  it("setAuthSession sets identity, roles, and authMode", () => {
    useSession.getState().setAuthSession("Ada Lovelace", ["developer", "release-approver"]);
    const s = useSession.getState();
    expect(s.authMode).toBe(true);
    expect(s.userName).toBe("Ada Lovelace");
    expect(s.roles).toEqual(["developer", "release-approver"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `apps/web`): `pnpm test -- rbac session`
Expected: FAIL — `rolesHavePermission` not exported; store has no `roles`/`authMode`/`setAuthSession`.

- [ ] **Step 3: Implement**

Append to `apps/web/src/lib/rbac.ts`:

```ts
/** Union semantics across multiple roles — mirrors the server's permissions_for. */
export function rolesHavePermission(roles: Role[], permission: Permission): boolean {
  return roles.some((role) => hasPermission(role, permission));
}
```

Rewrite `apps/web/src/stores/session.ts`:

```ts
import { create } from "zustand";
import type { EnvironmentName, Permission, Role } from "@secureflow/types";
import { rolesHavePermission } from "@/lib/rbac";

interface SessionState {
  roles: Role[];
  userName: string;
  /** True when identity came from an Entra ID token; hides the demo role switcher. */
  authMode: boolean;
  environment: EnvironmentName | "all";
  theme: "dark" | "light";
  sidebarCollapsed: boolean;
  setRole: (role: Role) => void;
  setAuthSession: (userName: string, roles: Role[]) => void;
  setEnvironment: (environment: EnvironmentName | "all") => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
}

export const useSession = create<SessionState>((set) => ({
  roles: ["devsecops-engineer"],
  userName: "Rowan Ashford",
  authMode: false,
  environment: "all",
  theme: "dark",
  sidebarCollapsed: false,
  setRole: (role) => set({ roles: [role] }),
  setAuthSession: (userName, roles) => set({ userName, roles, authMode: true }),
  setEnvironment: (environment) => set({ environment }),
  toggleTheme: () =>
    set((s) => {
      const theme = s.theme === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", theme === "dark");
      return { theme };
    }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));

export function useCan(permission: Permission): boolean {
  return useSession((s) => rolesHavePermission(s.roles, permission));
}
```

- [ ] **Step 4: Run tests — expect the two new files green, typecheck broken**

Run: `pnpm test -- rbac session`
Expected: PASS. (`pnpm typecheck` will fail on `topbar.tsx`, `settings.tsx`, `application-workspace.tsx` still reading `s.role` — Task 3 fixes them; do NOT commit yet.)

- [ ] **Step 5: Fix the three consumers (minimal edits, Task 3 does the UI work)**

This step only renames reads so the tree typechecks; visual/behavior changes for auth mode land in Task 3.

`apps/web/src/pages/application-workspace.tsx` line 50 and 333:

```tsx
const roles = useSession((s) => s.roles);
```

```tsx
<CardHeader title="Application settings" subtitle={`Visible read-only for role: ${roles.map(titleCase).join(", ")}`} />
```

`apps/web/src/pages/settings.tsx` line 13 and the badge:

```tsx
const { roles, theme, toggleTheme } = useSession();
```

```tsx
<Badge color="var(--accent)">{roles.map(titleCase).join(", ")}</Badge>
```

`apps/web/src/components/layout/topbar.tsx` line 38, 163, 176:

```tsx
const { roles, userName, environment, theme, setRole, setEnvironment, toggleTheme } =
  useSession();
```

```tsx
<span className="block text-[10px] text-fg-faint">{roles.map(titleCase).join(", ")}</span>
```

```tsx
{roles.includes(r) && <Badge color="var(--accent)">Active</Badge>}
```

- [ ] **Step 6: Full verification**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/rbac.ts apps/web/src/lib/rbac.test.ts apps/web/src/stores/session.ts apps/web/src/stores/session.test.ts apps/web/src/pages/application-workspace.tsx apps/web/src/pages/settings.tsx apps/web/src/components/layout/topbar.tsx
git commit -m "feat(web): roles-array session with union RBAC semantics"
```

---

### Task 3: Auth module — token registry, runtime config, MSAL singleton

**Files:**
- Create: `apps/web/src/lib/auth/token.ts`
- Create: `apps/web/src/lib/auth/config.ts`
- Create: `apps/web/src/lib/auth/msal.ts`
- Test: `apps/web/src/lib/auth/token.test.ts`, `apps/web/src/lib/auth/config.test.ts`, `apps/web/src/lib/auth/msal.test.ts`
- Modify: `apps/web/package.json` (new dependency)

**Interfaces:**
- Consumes: `GET /api/config` (Task 1 shape); `Role`/`ROLES` from `@secureflow/types`.
- Produces (later tasks import exactly these):
  - `token.ts`: `getAccessToken(): Promise<string | null>`, `handleUnauthorized(): void`, `registerTokenGetter(fn: () => Promise<string | null>): void`, `registerUnauthorizedHandler(fn: () => void): void`, `resetAuthHooks(): void` (tests only). **No MSAL import in this file — Tasks 4/5 import from here.**
  - `config.ts`: `interface RuntimeConfig { authEnabled: boolean; tenantId: string; clientId: string }`, `fetchRuntimeConfig(): Promise<RuntimeConfig>` (throws on non-OK).
  - `msal.ts`: `interface AuthAccount { name: string; roles: Role[] }`, `initAuth(config: RuntimeConfig): Promise<AuthAccount | null>` (null = redirecting away), `signOut(): Promise<void>`.

- [ ] **Step 1: Add the dependency**

Run (from `apps/web`): `pnpm add @azure/msal-browser`
Expected: resolves to the current 4.x line; lockfile updated at repo root.

- [ ] **Step 2: Write failing tests for `token.ts`**

Create `apps/web/src/lib/auth/token.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAccessToken,
  handleUnauthorized,
  registerTokenGetter,
  registerUnauthorizedHandler,
  resetAuthHooks,
} from "./token";

afterEach(() => resetAuthHooks());

describe("token registry", () => {
  it("returns null when no getter is registered (demo mode)", async () => {
    await expect(getAccessToken()).resolves.toBeNull();
  });

  it("delegates to the registered getter (auth mode)", async () => {
    registerTokenGetter(async () => "tok-123");
    await expect(getAccessToken()).resolves.toBe("tok-123");
  });

  it("handleUnauthorized is a no-op without a handler, calls it when registered", () => {
    expect(() => handleUnauthorized()).not.toThrow();
    const handler = vi.fn();
    registerUnauthorizedHandler(handler);
    handleUnauthorized();
    expect(handler).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: Write failing tests for `config.ts`**

Create `apps/web/src/lib/auth/config.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRuntimeConfig } from "./config";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("fetchRuntimeConfig", () => {
  it("fetches /api/config and returns the parsed body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ authEnabled: true, tenantId: "t", clientId: "c" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(fetchRuntimeConfig()).resolves.toEqual({
      authEnabled: true,
      tenantId: "t",
      clientId: "c",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/config");
  });

  it("throws on a non-OK response (fail closed)", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(fetchRuntimeConfig()).rejects.toThrow(/503/);
  });
});
```

- [ ] **Step 4: Run to verify both fail**

Run: `pnpm test -- auth`
Expected: FAIL — modules don't exist.

- [ ] **Step 5: Implement `token.ts` and `config.ts`**

`apps/web/src/lib/auth/token.ts`:

```ts
/**
 * Token registry: the seam between MSAL and the data layer. http.ts and
 * sse-client.ts import from HERE, never from msal.ts, so the demo bundle
 * carries no MSAL code. msal.ts registers real implementations at init.
 */
type TokenGetter = () => Promise<string | null>;

let getter: TokenGetter | null = null;
let unauthorized: (() => void) | null = null;

export function registerTokenGetter(fn: TokenGetter): void {
  getter = fn;
}

export function registerUnauthorizedHandler(fn: () => void): void {
  unauthorized = fn;
}

/** Null in demo mode (nothing registered) — callers skip the Authorization header. */
export async function getAccessToken(): Promise<string | null> {
  return getter ? getter() : null;
}

/** Called on a 401 in auth mode: triggers an interactive re-auth redirect. */
export function handleUnauthorized(): void {
  unauthorized?.();
}

export function resetAuthHooks(): void {
  getter = null;
  unauthorized = null;
}
```

`apps/web/src/lib/auth/config.ts`:

```ts
export interface RuntimeConfig {
  authEnabled: boolean;
  tenantId: string;
  clientId: string;
}

/** Reads the server's auth posture. Throws on failure — bootstrap fails closed. */
export async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch("/api/config");
  if (!response.ok) {
    throw new Error(`config fetch failed: ${response.status}`);
  }
  return (await response.json()) as RuntimeConfig;
}
```

- [ ] **Step 6: Run token/config tests to verify they pass**

Run: `pnpm test -- auth`
Expected: PASS.

- [ ] **Step 7: Write failing tests for `msal.ts`**

Create `apps/web/src/lib/auth/msal.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAccessToken, resetAuthHooks } from "./token";

const mocks = vi.hoisted(() => {
  const instance = {
    initialize: vi.fn(async () => {}),
    handleRedirectPromise: vi.fn(async () => null as unknown),
    getAllAccounts: vi.fn(() => [] as unknown[]),
    setActiveAccount: vi.fn(),
    loginRedirect: vi.fn(async () => {}),
    acquireTokenSilent: vi.fn(async () => ({ accessToken: "at-1" })),
    acquireTokenRedirect: vi.fn(async () => {}),
    logoutRedirect: vi.fn(async () => {}),
  };
  class InteractionRequiredAuthError extends Error {}
  return { instance, InteractionRequiredAuthError };
});

vi.mock("@azure/msal-browser", () => ({
  PublicClientApplication: vi.fn(() => mocks.instance),
  InteractionRequiredAuthError: mocks.InteractionRequiredAuthError,
}));

const CONFIG = { authEnabled: true, tenantId: "tenant-1", clientId: "client-1" };
const ACCOUNT = {
  username: "ada@example.com",
  idTokenClaims: { name: "Ada Lovelace", roles: ["developer", "not-a-role"] },
};

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthHooks();
  vi.resetModules();
});

describe("initAuth", () => {
  it("redirects to sign-in when no account exists and returns null", async () => {
    const { initAuth } = await import("./msal");
    mocks.instance.getAllAccounts.mockReturnValue([]);
    const account = await initAuth(CONFIG);
    expect(account).toBeNull();
    expect(mocks.instance.loginRedirect).toHaveBeenCalledWith({
      scopes: ["api://client-1/access"],
    });
  });

  it("returns name and known roles, dropping unknown role strings", async () => {
    const { initAuth } = await import("./msal");
    mocks.instance.getAllAccounts.mockReturnValue([ACCOUNT]);
    const account = await initAuth(CONFIG);
    expect(account).toEqual({ name: "Ada Lovelace", roles: ["developer"] });
    expect(mocks.instance.setActiveAccount).toHaveBeenCalledWith(ACCOUNT);
  });

  it("registers a token getter that acquires silently", async () => {
    const { initAuth } = await import("./msal");
    mocks.instance.getAllAccounts.mockReturnValue([ACCOUNT]);
    await initAuth(CONFIG);
    await expect(getAccessToken()).resolves.toBe("at-1");
    expect(mocks.instance.acquireTokenSilent).toHaveBeenCalledWith({
      scopes: ["api://client-1/access"],
    });
  });

  it("falls back to acquireTokenRedirect when silent acquisition needs interaction", async () => {
    const { initAuth } = await import("./msal");
    mocks.instance.getAllAccounts.mockReturnValue([ACCOUNT]);
    mocks.instance.acquireTokenSilent.mockRejectedValueOnce(
      new mocks.InteractionRequiredAuthError("interaction_required"),
    );
    await initAuth(CONFIG);
    await expect(getAccessToken()).resolves.toBeNull();
    expect(mocks.instance.acquireTokenRedirect).toHaveBeenCalled();
  });
});
```

- [ ] **Step 8: Run to verify it fails**

Run: `pnpm test -- msal`
Expected: FAIL — `./msal` doesn't exist.

- [ ] **Step 9: Implement `msal.ts`**

`apps/web/src/lib/auth/msal.ts`:

```ts
import { InteractionRequiredAuthError, PublicClientApplication } from "@azure/msal-browser";
import { ROLES, type Role } from "@secureflow/types";
import type { RuntimeConfig } from "./config";
import { registerTokenGetter, registerUnauthorizedHandler } from "./token";

export interface AuthAccount {
  name: string;
  roles: Role[];
}

let pca: PublicClientApplication | null = null;
let scopes: string[] = [];

/**
 * Constructs the MSAL singleton, completes any pending redirect, and either
 * returns the signed-in account or starts a loginRedirect (returning null —
 * the page is navigating away). Only ever imported dynamically, and only when
 * /api/config reports authEnabled.
 */
export async function initAuth(config: RuntimeConfig): Promise<AuthAccount | null> {
  scopes = [`api://${config.clientId}/access`];
  pca = new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      redirectUri: window.location.origin,
      postLogoutRedirectUri: window.location.origin,
    },
    cache: { cacheLocation: "sessionStorage" },
  });
  await pca.initialize();
  const result = await pca.handleRedirectPromise();
  const account = result?.account ?? pca.getAllAccounts()[0] ?? null;
  if (!account) {
    await pca.loginRedirect({ scopes });
    return null;
  }
  pca.setActiveAccount(account);
  registerTokenGetter(acquireToken);
  registerUnauthorizedHandler(() => {
    void pca?.acquireTokenRedirect({ scopes });
  });
  const claims = (account.idTokenClaims ?? {}) as {
    name?: string;
    preferred_username?: string;
    roles?: string[];
  };
  const roles = (claims.roles ?? []).filter((r): r is Role =>
    (ROLES as readonly string[]).includes(r),
  );
  return { name: claims.name ?? claims.preferred_username ?? account.username, roles };
}

async function acquireToken(): Promise<string | null> {
  if (!pca) return null;
  try {
    return (await pca.acquireTokenSilent({ scopes })).accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      await pca.acquireTokenRedirect({ scopes });
      return null;
    }
    throw error;
  }
}

export async function signOut(): Promise<void> {
  await pca?.logoutRedirect();
}
```

(If `ROLES` is typed as `Role[]` rather than a `readonly` tuple, drop the `as readonly string[]` cast to whatever satisfies `.includes`.)

- [ ] **Step 10: Run all auth tests**

Run: `pnpm test -- auth msal && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/lib/auth apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): msal auth module behind a token registry seam"
```

---

### Task 4: Bearer attach in the HTTP provider

**Files:**
- Modify: `apps/web/src/lib/providers/http.ts` (the `api()` helper, lines 39–56)
- Test: `apps/web/src/lib/providers/http.test.ts`

**Interfaces:**
- Consumes: `getAccessToken`, `handleUnauthorized` from `@/lib/auth/token` (Task 3).
- Produces: no signature changes — all providers keep working.

- [ ] **Step 1: Write the failing tests**

Append a describe block to `apps/web/src/lib/providers/http.test.ts` (note: `afterEach` must also call `resetAuthHooks()` — add it to the existing `afterEach`):

```ts
import { registerTokenGetter, registerUnauthorizedHandler, resetAuthHooks } from "@/lib/auth/token";

// in the existing afterEach:
afterEach(() => {
  vi.unstubAllGlobals();
  resetAuthHooks();
});

describe("auth-mode token attach", () => {
  it("sends no Authorization header in demo mode", async () => {
    fetchMock.mockResolvedValue(okJson([]));
    await http.deploymentProvider.listApplications();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  });

  it("attaches Bearer token when a getter is registered", async () => {
    registerTokenGetter(async () => "tok-42");
    fetchMock.mockResolvedValue(okJson([]));
    await http.deploymentProvider.listApplications();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tok-42");
  });

  it("keeps Content-Type alongside Authorization on JSON posts", async () => {
    registerTokenGetter(async () => "tok-42");
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await http.deploymentProvider.promote("app-1", "production");
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok-42");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("invokes the unauthorized handler on a 401 in auth mode", async () => {
    registerTokenGetter(async () => "tok-42");
    const onUnauthorized = vi.fn();
    registerUnauthorizedHandler(onUnauthorized);
    fetchMock.mockResolvedValue(okJson({ detail: "invalid_token" }, 401));
    await expect(http.deploymentProvider.listApplications()).rejects.toThrow();
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("does not invoke the unauthorized handler on 401 in demo mode", async () => {
    const onUnauthorized = vi.fn();
    registerUnauthorizedHandler(onUnauthorized);
    fetchMock.mockResolvedValue(okJson({ detail: "invalid_token" }, 401));
    await expect(http.deploymentProvider.listApplications()).rejects.toThrow();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- http`
Expected: FAIL on the Bearer-attach and 401-handler tests.

- [ ] **Step 3: Implement**

Replace the `api()` helper in `apps/web/src/lib/providers/http.ts`:

```ts
import { getAccessToken, handleUnauthorized } from "@/lib/auth/token";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken(); // null in demo mode
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    // 401 with a token means it expired or was revoked mid-session: hand off
    // to MSAL for an interactive redirect, and still surface the error below.
    if (response.status === 401 && token !== null) handleUnauthorized();
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // non-JSON error body; keep the status text
    }
    throw new Error(`API request failed: ${detail}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
```

- [ ] **Step 4: Run the web suite**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass (existing http tests unaffected — header shape stays compatible).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/providers/http.ts apps/web/src/lib/providers/http.test.ts
git commit -m "feat(web): attach bearer tokens to API requests in auth mode"
```

---

### Task 5: SSE stream with query token + fresh-token reconnect

**Files:**
- Modify: `apps/web/src/lib/realtime/sse-client.ts` (`startEventStream`, lines 16–25)
- Test: `apps/web/src/lib/realtime/sse-client.test.ts`

**Interfaces:**
- Consumes: `getAccessToken` from `@/lib/auth/token`.
- Produces: `startEventStream(queryClient): () => void` — same signature `App.tsx` already uses; no App changes needed.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/lib/realtime/sse-client.test.ts`:

```ts
import { afterEach, beforeEach } from "vitest";
import { registerTokenGetter, resetAuthHooks } from "@/lib/auth/token";
import { startEventStream } from "./sse-client";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  close() {
    this.closed = true;
  }
}

describe("startEventStream auth wiring", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    resetAuthHooks();
  });

  it("connects without a token in demo mode", async () => {
    const stop = startEventStream(new QueryClient());
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events");
    stop();
  });

  it("appends access_token in auth mode", async () => {
    registerTokenGetter(async () => "tok-sse");
    const stop = startEventStream(new QueryClient());
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events?access_token=tok-sse");
    stop();
  });

  it("reconnects with a fresh token after an error", async () => {
    let n = 0;
    registerTokenGetter(async () => `tok-${++n}`);
    const stop = startEventStream(new QueryClient());
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    FakeEventSource.instances[0]!.onerror?.();
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    expect(FakeEventSource.instances[1]!.url).toBe("/api/events?access_token=tok-2");
    stop();
  });

  it("does not reconnect after stop() is called", async () => {
    registerTokenGetter(async () => "tok");
    const stop = startEventStream(new QueryClient());
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    stop();
    FakeEventSource.instances[0]!.onerror?.();
    await vi.advanceTimersByTimeAsync(5000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
```

(Merge imports with the file's existing ones; `QueryClient` and `vi` are already imported.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- sse-client`
Expected: FAIL — URL never carries a token; no reconnect logic.

- [ ] **Step 3: Implement**

Replace `startEventStream` in `apps/web/src/lib/realtime/sse-client.ts`:

```ts
import { getAccessToken } from "@/lib/auth/token";

const RECONNECT_DELAY_MS = 3000;

export function startEventStream(queryClient: QueryClient): () => void {
  let source: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const attach = (s: EventSource) => {
    s.addEventListener("run-updated", (event) => {
      handleRunUpdated(queryClient, JSON.parse((event as MessageEvent).data));
    });
    s.addEventListener("notification", (event) => {
      handleNotification(queryClient, JSON.parse((event as MessageEvent).data));
    });
  };

  const connect = async () => {
    const token = await getAccessToken();
    if (closed) return;
    if (token === null) {
      // Demo mode: EventSource's native reconnect is fine — the URL never goes stale.
      source = new EventSource("/api/events");
      attach(source);
      return;
    }
    // Auth mode: native reconnect would replay the original (stale) token, so
    // replace the stream with a freshly-tokened one on every error.
    source = new EventSource(`/api/events?access_token=${encodeURIComponent(token)}`);
    attach(source);
    source.onerror = () => {
      source?.close();
      if (!closed) retryTimer = setTimeout(() => void connect(), RECONNECT_DELAY_MS);
    };
  };

  void connect();
  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    source?.close();
  };
}
```

- [ ] **Step 4: Run the suite**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/realtime/sse-client.ts apps/web/src/lib/realtime/sse-client.test.ts
git commit -m "feat(web): sse stream sends access_token and re-tokens on reconnect"
```

---

### Task 6: Fail-closed bootstrap + auth-mode topbar

**Files:**
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/components/layout/topbar.tsx` (profile dropdown, lines 152–180)
- Modify: `apps/web/src/pages/settings.tsx` (stale copy)

**Interfaces:**
- Consumes: `fetchRuntimeConfig` (Task 3), `initAuth`/`signOut` via dynamic import (Task 3), `setAuthSession` (Task 2), `dataSource` from `@/lib/providers`.
- Produces: nothing downstream — this is the top of the wiring.

- [ ] **Step 1: Rewrite `main.tsx`**

```tsx
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { fetchRuntimeConfig } from "@/lib/auth/config";
import { dataSource } from "@/lib/providers";
import { useSession } from "@/stores/session";

const root = createRoot(document.getElementById("root")!);

function renderApp() {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// Fail closed: a broken /api/config or MSAL setup shows this splash rather
// than silently dropping to the unauthenticated demo experience.
function renderError(message: string) {
  root.render(
    <StrictMode>
      <div className="grid min-h-screen place-items-center bg-canvas p-6">
        <div className="max-w-md rounded-lg border border-line bg-surface p-6 text-center">
          <h1 className="text-lg font-semibold text-fg">SecureFlow could not start</h1>
          <p className="mt-2 text-sm text-fg-muted">{message}</p>
        </div>
      </div>
    </StrictMode>,
  );
}

async function bootstrap() {
  // Memory mode has no API to ask; it is always the demo experience.
  if (dataSource === "memory") return renderApp();

  let config;
  try {
    config = await fetchRuntimeConfig();
  } catch {
    return renderError("Could not load runtime configuration from the API.");
  }
  if (!config.authEnabled) return renderApp();

  try {
    const { initAuth } = await import("@/lib/auth/msal");
    const account = await initAuth(config);
    if (!account) return; // loginRedirect is navigating away
    useSession.getState().setAuthSession(account.name, account.roles);
    renderApp();
  } catch {
    renderError("Sign-in failed. Check the Microsoft Entra ID configuration.");
  }
}

void bootstrap();
```

- [ ] **Step 2: Auth-mode profile dropdown in `topbar.tsx`**

Add `LogOut` to the lucide imports and `authMode` to the store destructure (line 38):

```tsx
const { roles, userName, authMode, environment, theme, setRole, setEnvironment, toggleTheme } =
  useSession();
```

Replace the profile `DropdownContent` (lines 167–179):

```tsx
<DropdownContent align="end" className="w-64">
  {authMode ? (
    <>
      <DropdownLabel>
        <span className="flex items-center gap-1.5">
          <UserRound size={12} aria-hidden /> Signed in with Microsoft Entra ID
        </span>
      </DropdownLabel>
      <DropdownItem
        onSelect={() => {
          void import("@/lib/auth/msal").then((m) => m.signOut());
        }}
      >
        <span className="flex items-center gap-1.5">
          <LogOut size={12} aria-hidden /> Sign out
        </span>
      </DropdownItem>
    </>
  ) : (
    <>
      <DropdownLabel>
        <span className="flex items-center gap-1.5">
          <UserRound size={12} aria-hidden /> Simulated role (RBAC demo)
        </span>
      </DropdownLabel>
      {ROLES.map((r) => (
        <DropdownItem key={r} onSelect={() => setRole(r as Role)}>
          <span className="flex-1">{titleCase(r)}</span>
          {roles.includes(r as Role) && <Badge color="var(--accent)">Active</Badge>}
        </DropdownItem>
      ))}
    </>
  )}
</DropdownContent>
```

- [ ] **Step 3: Fix stale copy in `settings.tsx`**

The Session card's explanatory paragraph still says roles come from "group claims". Replace that paragraph with:

```tsx
<p className="text-xs text-fg-faint">
  Switch roles from the profile menu in the top bar to demo RBAC behavior. When Entra ID
  sign-in is enabled, roles come from the token's app-role claims and the switcher is hidden.
</p>
```

- [ ] **Step 4: Verify**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: all pass. In the build output, confirm no chunk in the main entry graph contains msal (`grep -ril msal dist/assets` should only match a lazy chunk, or nothing in the entry file).

- [ ] **Step 5: Manual smoke (demo mode unchanged)**

Run: `pnpm e2e:http` (Playwright HTTP smoke; needs the local postgres container from the main checkout — see repo traps).
Expected: PASS — demo mode byte-identical.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/main.tsx apps/web/src/components/layout/topbar.tsx apps/web/src/pages/settings.tsx
git commit -m "feat(web): fail-closed auth bootstrap and entra sign-in topbar"
```

---

### Task 7: Terraform — entra-app module + auth_enabled gate

**Files:**
- Create: `infrastructure/modules/entra-app/main.tf`
- Modify: `infrastructure/modules/container-apps/main.tf`
- Modify: `infrastructure/environments/{dev,staging,prod}/main.tf`
- Modify: `infrastructure/environments/{dev,staging,prod}/variables.tf`
- Modify: `infrastructure/environments/{dev,staging,prod}/backend.tf`

**Interfaces:**
- Produces: module outputs `client_id`, `tenant_id`; container-apps variables `auth_enabled` (bool, default false), `entra_tenant_id`, `entra_client_id` (strings, default "").

- [ ] **Step 1: Create `infrastructure/modules/entra-app/main.tf`**

```hcl
terraform {
  required_providers {
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.1"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

variable "display_name" { type = string }
variable "spa_redirect_uris" {
  description = "SPA redirect URIs. localhost for dev; add the container app FQDN after the first apply."
  type        = list(string)
}
# Role values must match packages/types/src/role-permissions.json verbatim —
# the API trusts the token's roles claim as Role strings.
locals {
  app_roles = [
    "developer",
    "devsecops-engineer",
    "security-engineer",
    "platform-engineer",
    "application-owner",
    "compliance-reviewer",
    "release-approver",
    "administrator",
  ]
}

data "azuread_client_config" "current" {}

resource "random_uuid" "access_scope" {}

resource "random_uuid" "app_role" {
  for_each = toset(local.app_roles)
}

resource "azuread_application" "spa" {
  display_name     = var.display_name
  sign_in_audience = "AzureADMyOrg"

  single_page_application {
    redirect_uris = var.spa_redirect_uris
  }

  api {
    requested_access_token_version = 2

    oauth2_permission_scope {
      id                         = random_uuid.access_scope.result
      value                      = "access"
      type                       = "User"
      admin_consent_display_name = "Access SecureFlow API"
      admin_consent_description  = "Allows the SPA to call the SecureFlow API as the signed-in user."
      user_consent_display_name  = "Access SecureFlow API"
      user_consent_description   = "Allows the SPA to call the SecureFlow API on your behalf."
      enabled                    = true
    }
  }

  dynamic "app_role" {
    for_each = toset(local.app_roles)
    content {
      id                   = random_uuid.app_role[app_role.value].result
      value                = app_role.value
      display_name         = app_role.value
      description          = "SecureFlow role: ${app_role.value}"
      allowed_member_types = ["User"]
      enabled              = true
    }
  }
}

# api://<client_id> — set post-creation to avoid a self-reference cycle.
resource "azuread_application_identifier_uri" "spa" {
  application_id = azuread_application.spa.id
  identifier_uri = "api://${azuread_application.spa.client_id}"
}

# Required so users can be assigned to the app roles.
resource "azuread_service_principal" "spa" {
  client_id = azuread_application.spa.client_id
}

output "client_id" { value = azuread_application.spa.client_id }
output "tenant_id" { value = data.azuread_client_config.current.tenant_id }
```

Note: user→app-role assignment is intentionally NOT managed here (spec: portal/per-person).

- [ ] **Step 2: Extend `infrastructure/modules/container-apps/main.tf`**

Add variables (after `enable_private_networking`):

```hcl
variable "auth_enabled" {
  description = "Inject Entra ID JWT enforcement env into the API container. Off preserves the open demo posture."
  type        = bool
  default     = false
}
variable "entra_tenant_id" {
  type    = string
  default = ""
}
variable "entra_client_id" {
  type    = string
  default = ""
}
```

Add inside the `container "api"` block, after the existing `env` block:

```hcl
      dynamic "env" {
        for_each = var.auth_enabled ? {
          AUTH_ENABLED    = "1"
          ENTRA_TENANT_ID = var.entra_tenant_id
          ENTRA_CLIENT_ID = var.entra_client_id
        } : {}
        content {
          name  = env.key
          value = env.value
        }
      }
```

- [ ] **Step 3: Wire each environment (dev, staging, prod — identical edits)**

`variables.tf` — add:

```hcl
variable "auth_enabled" {
  description = "Provision the Entra app registration and turn on API JWT enforcement."
  type        = bool
  default     = false
}

variable "spa_redirect_uris" {
  description = "SPA redirect URIs for the Entra app registration. Add https://<api_fqdn> after the first apply."
  type        = list(string)
  default     = ["http://localhost:5173"]
}
```

`backend.tf` — add to `required_providers`:

```hcl
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.1"
    }
```

and after the `azurerm` provider block:

```hcl
provider "azuread" {
  # Same OIDC federation / az login credentials as azurerm.
  use_oidc = true
}
```

`main.tf` — add before `module "container_apps"`:

```hcl
module "entra_app" {
  count             = var.auth_enabled ? 1 : 0
  source            = "../../modules/entra-app"
  display_name      = local.name_prefix
  spa_redirect_uris = var.spa_redirect_uris
}
```

and add to the `module "container_apps"` arguments:

```hcl
  auth_enabled    = var.auth_enabled
  entra_tenant_id = var.auth_enabled ? module.entra_app[0].tenant_id : ""
  entra_client_id = var.auth_enabled ? module.entra_app[0].client_id : ""
```

- [ ] **Step 4: Format and validate**

```bash
cd infrastructure && terraform fmt -recursive
cd environments/dev && terraform init -backend=false -input=false && terraform validate
```

Repeat validate for `staging` and `prod`. Expected: `Success! The configuration is valid.`

If `terraform init` cannot reach the registry from this environment, note it and rely on the CI terraform job — do not skip fmt.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/
git commit -m "feat(infra): entra app registration module behind auth_enabled gate"
```

---

### Task 8: Documentation

**Files:**
- Modify: `docs/security-model.md` (SPA/auth section)
- Modify: `docs/deployment.md` (env table + tenant enablement steps)

**Interfaces:** none — prose only. Read both files first; edit in place, matching surrounding style.

- [ ] **Step 1: Update `docs/security-model.md`**

Find the section stating the SPA sends no tokens / enabling `AUTH_ENABLED=1` breaks the SPA (added by the previous plan). Replace with the implemented behavior:

- SPA reads `GET /api/config` at bootstrap (open route; tenant/client IDs are public SPA values).
- Auth mode: MSAL redirect sign-in, `roles` from the token's app-role claims, role switcher hidden, union permission semantics client-side mirror `permissions_for`; server remains the enforcement point.
- Demo mode unchanged; fail-closed bootstrap (config/MSAL failure → error splash, never silent demo fallback).
- SSE uses `?access_token=` (already documented in the threat model) with fresh-token manual reconnect.

- [ ] **Step 2: Update `docs/deployment.md`**

- Env table: no new API env vars (AUTH_ENABLED/ENTRA_* already listed) — verify and leave; add a note that terraform `auth_enabled=true` injects them automatically.
- Add an "Enabling Entra ID sign-in" subsection: set `auth_enabled=true` in the environment tfvars → apply (creates app registration + service principal, injects container env) → add `https://<api_fqdn>` to `spa_redirect_uris` and re-apply → assign users to app roles in the portal (Enterprise application → Users and groups) → verify with an incognito sign-in.

- [ ] **Step 3: Verify + commit**

Skim both rendered files for contradictions with the spec.

```bash
git add docs/security-model.md docs/deployment.md
git commit -m "docs: spa msal wiring and entra tenant enablement"
```

---

## Final verification (after all tasks)

- [ ] `cd apps/api && uv run pytest` — all green
- [ ] `cd apps/web && pnpm test && pnpm typecheck && pnpm lint && pnpm build` — all green
- [ ] `cd apps/web && pnpm e2e:http` — demo-mode smoke green (local postgres container required)
- [ ] `terraform validate` green in all three environments
- [ ] Push and confirm CI run fully green (deploy jobs `skipped` = intended)
