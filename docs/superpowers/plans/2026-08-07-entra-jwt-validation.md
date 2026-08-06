# Entra ID JWT Validation + Server-Side RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bearer-token validation (Entra ID shape, self-signed JWKS fixtures) plus server-side `ROLE_PERMISSIONS` enforcement on every `/api` route of the FastAPI API.

**Architecture:** New `apps/api/src/secureflow_api/auth/` package — env config (fail-fast), cached PyJWKClient wrapper, Python RBAC matrix (parity-tested against a new canonical JSON in `packages/types`), `Principal` dataclass, and FastAPI dependencies `get_principal` / `get_principal_sse` / `require_permission`. Routes wired via decorator `dependencies=[...]`; body-dependent checks in handlers. Disabled mode (default) injects a synthetic administrator so behavior is unchanged.

**Tech Stack:** Python 3.13, FastAPI, PyJWT + cryptography (`pyjwt[crypto]`), pytest(-asyncio), uv workspace, pnpm/TypeScript for the shared JSON.

**Spec:** `docs/superpowers/specs/2026-08-07-entra-jwt-validation-design.md` — read it first; its "Decisions" section is binding.

## Global Constraints

- `AUTH_ENABLED` defaults **off**; with it off, every existing test and demo behavior must be byte-identical (including `decided_by == "You"`).
- `AUTH_ENABLED=1` with missing `ENTRA_TENANT_ID` or `ENTRA_CLIENT_ID` → raise at startup (fail-fast).
- Algorithms pinned to `["RS256"]`. 401 for token problems (with `WWW-Authenticate: Bearer` header), 403 for permission problems. Generic details only — never echo claims.
- `?access_token=` accepted **only** on `/api/events`. `/health` stays unauthenticated.
- Role claim is `roles` (Entra app roles), values are `Role` enum strings verbatim. Unknown values ignored with a warning; zero valid roles → authenticated but permission-less.
- New runtime dep: `pyjwt[crypto]>=2.10` only. No `fastapi-azure-auth`, no network in tests.
- Finding status literal is `accepted-risk` (NOT "risk-accepted").
- Run API tests from repo root: `uv run --package secureflow-api pytest apps/api/tests` (needs local Postgres from `docker-compose up -d`; conftest handles migrate/seed).
- Commit after every task. Commit messages: repo style is lowercase conventional (`feat(api): …`, `docs: …`, `test(api): …`).

---

### Task 1: Canonical role-permissions JSON shared by web and (later) API tests

**Files:**
- Create: `packages/types/src/role-permissions.json`
- Modify: `packages/types/package.json` (exports map)
- Modify: `packages/types/tsconfig.json` (resolveJsonModule)
- Modify: `apps/web/tsconfig.json` (resolveJsonModule)
- Modify: `apps/web/src/lib/rbac.ts`
- Test: existing `apps/web/src/lib/rbac.test.ts` (unchanged — it must stay green)

**Interfaces:**
- Produces: `packages/types/src/role-permissions.json` — object keyed by all 8 roles, values = permission-string arrays. Task 3's Python parity test reads this exact file. `ROLE_PERMISSIONS` / `hasPermission` exports of `rbac.ts` keep their current signatures.

- [ ] **Step 1: Create the JSON** (content is the current `rbac.ts` matrix with the `BASE` spread expanded — do not edit values):

```json
{
  "developer": [
    "audit.view",
    "evidence.download",
    "pipeline.trigger",
    "pipeline.retry-stage",
    "remediation.create"
  ],
  "devsecops-engineer": [
    "audit.view",
    "evidence.download",
    "pipeline.trigger",
    "pipeline.retry-stage",
    "finding.update-status",
    "remediation.create",
    "deployment.request-changes"
  ],
  "security-engineer": [
    "audit.view",
    "evidence.download",
    "finding.update-status",
    "risk.accept",
    "remediation.create",
    "deployment.request-changes",
    "deployment.reject"
  ],
  "platform-engineer": [
    "audit.view",
    "evidence.download",
    "pipeline.trigger",
    "pipeline.retry-stage",
    "deployment.rollback",
    "integration.manage"
  ],
  "application-owner": [
    "audit.view",
    "evidence.download",
    "deployment.request-changes",
    "remediation.create",
    "risk.accept"
  ],
  "compliance-reviewer": [
    "audit.view",
    "evidence.download",
    "compliance.review"
  ],
  "release-approver": [
    "audit.view",
    "evidence.download",
    "deployment.approve",
    "deployment.reject",
    "deployment.request-changes",
    "deployment.promote",
    "deployment.rollback"
  ],
  "administrator": [
    "audit.view",
    "evidence.download",
    "deployment.approve",
    "deployment.reject",
    "deployment.request-changes",
    "deployment.promote",
    "deployment.rollback",
    "pipeline.retry-stage",
    "pipeline.trigger",
    "risk.accept",
    "finding.update-status",
    "remediation.create",
    "compliance.review",
    "integration.manage",
    "settings.manage"
  ]
}
```

- [ ] **Step 2: Expose it from the types package.** In `packages/types/package.json`, extend `exports`:

```json
"exports": {
  ".": "./src/index.ts",
  "./role-permissions.json": "./src/role-permissions.json"
}
```

- [ ] **Step 3: Enable JSON imports.** Add `"resolveJsonModule": true` to `compilerOptions` in BOTH `packages/types/tsconfig.json` and `apps/web/tsconfig.json`.

- [ ] **Step 4: Rewrite `apps/web/src/lib/rbac.ts`** to consume the JSON (public API unchanged):

```ts
import type { Permission, Role } from "@secureflow/types";
import matrix from "@secureflow/types/role-permissions.json";

export const ROLE_PERMISSIONS = matrix as Record<Role, Permission[]>;

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
```

- [ ] **Step 5: Verify web side is green**

Run: `pnpm -r typecheck && pnpm --filter @secureflow/web test`
Expected: typecheck passes; `rbac.test.ts` (and the rest of the web suite) passes unchanged. If typecheck complains about the JSON import path, check the exports map spelling from Step 2 — do not switch to a relative `../../..` import.

- [ ] **Step 6: Commit**

```bash
git add packages/types apps/web/src/lib/rbac.ts apps/web/tsconfig.json
git commit -m "refactor(rbac): canonical role-permissions json shared from types package"
```

---

### Task 2: `pyjwt` dependency + `auth/config.py`

**Files:**
- Modify: `apps/api/pyproject.toml`
- Create: `apps/api/src/secureflow_api/auth/__init__.py` (empty)
- Create: `apps/api/src/secureflow_api/auth/config.py`
- Test: `apps/api/tests/test_auth_config.py`

**Interfaces:**
- Produces: `AuthConfig` frozen dataclass with fields `enabled: bool`, `tenant_id: str`, `client_id: str`, `jwks_url: str`, `issuer: str`; `load_auth_config() -> AuthConfig` (reads env on every call — no caching, tests flip env freely); `AuthConfigError(RuntimeError)`.

- [ ] **Step 1: Add the dependency.** In `apps/api/pyproject.toml` `dependencies`, append `"pyjwt[crypto]>=2.10",`. Then from repo root:

Run: `uv sync --package secureflow-api`
Expected: lockfile updates, `pyjwt` + `cryptography` installed.

- [ ] **Step 2: Write the failing tests** — `apps/api/tests/test_auth_config.py`:

```python
import pytest

from secureflow_api.auth.config import AuthConfig, AuthConfigError, load_auth_config


def test_disabled_by_default(monkeypatch):
    monkeypatch.delenv("AUTH_ENABLED", raising=False)
    config = load_auth_config()
    assert config == AuthConfig(enabled=False)


def test_enabled_requires_tenant_and_client(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "1")
    monkeypatch.delenv("ENTRA_TENANT_ID", raising=False)
    monkeypatch.delenv("ENTRA_CLIENT_ID", raising=False)
    with pytest.raises(AuthConfigError, match="ENTRA_TENANT_ID"):
        load_auth_config()


def test_enabled_derives_issuer_and_jwks_url(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "1")
    monkeypatch.setenv("ENTRA_TENANT_ID", "tenant-guid")
    monkeypatch.setenv("ENTRA_CLIENT_ID", "api://client")
    monkeypatch.delenv("ENTRA_JWKS_URL", raising=False)
    config = load_auth_config()
    assert config.enabled is True
    assert config.issuer == "https://login.microsoftonline.com/tenant-guid/v2.0"
    assert config.jwks_url == "https://login.microsoftonline.com/tenant-guid/discovery/v2.0/keys"


def test_jwks_url_override(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "1")
    monkeypatch.setenv("ENTRA_TENANT_ID", "tenant-guid")
    monkeypatch.setenv("ENTRA_CLIENT_ID", "api://client")
    monkeypatch.setenv("ENTRA_JWKS_URL", "http://localhost:9999/jwks.json")
    assert load_auth_config().jwks_url == "http://localhost:9999/jwks.json"
```

- [ ] **Step 3: Run to verify failure**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_auth_config.py -v`
Expected: FAIL — `ModuleNotFoundError: secureflow_api.auth`

- [ ] **Step 4: Implement** — create empty `auth/__init__.py`, then `auth/config.py`:

```python
"""Auth configuration from environment. AUTH_ENABLED=1 turns enforcement on
and makes missing Entra config fatal; the default keeps every route open for
demos (one loud log line at startup, wired in main.py's lifespan)."""

import os
from dataclasses import dataclass


class AuthConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class AuthConfig:
    enabled: bool
    tenant_id: str = ""
    client_id: str = ""
    jwks_url: str = ""
    issuer: str = ""


def load_auth_config() -> AuthConfig:
    if os.environ.get("AUTH_ENABLED", "0") != "1":
        return AuthConfig(enabled=False)
    tenant_id = os.environ.get("ENTRA_TENANT_ID", "")
    client_id = os.environ.get("ENTRA_CLIENT_ID", "")
    missing = [
        name
        for name, value in (("ENTRA_TENANT_ID", tenant_id), ("ENTRA_CLIENT_ID", client_id))
        if not value
    ]
    if missing:
        raise AuthConfigError(f"AUTH_ENABLED=1 but not set: {', '.join(missing)}")
    return AuthConfig(
        enabled=True,
        tenant_id=tenant_id,
        client_id=client_id,
        jwks_url=os.environ.get("ENTRA_JWKS_URL")
        or f"https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys",
        issuer=f"https://login.microsoftonline.com/{tenant_id}/v2.0",
    )
```

- [ ] **Step 5: Run to verify pass**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_auth_config.py -v`
Expected: 4 PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/pyproject.toml uv.lock apps/api/src/secureflow_api/auth apps/api/tests/test_auth_config.py
git commit -m "feat(api): auth config with fail-fast entra validation"
```

(If `uv.lock` lives elsewhere, `git status` after Step 1 shows the real lockfile path — stage that.)

---

### Task 3: `auth/rbac.py` + parity test against the canonical JSON

**Files:**
- Create: `apps/api/src/secureflow_api/auth/rbac.py`
- Test: `apps/api/tests/test_auth_rbac.py`

**Interfaces:**
- Consumes: `packages/types/src/role-permissions.json` (Task 1), `Role` Literal from `secureflow_api.models`.
- Produces: `Permission` Literal type (15 values), `ROLE_PERMISSIONS: dict[Role, tuple[Permission, ...]]`, `permissions_for(roles: Iterable[Role]) -> frozenset[Permission]`.

- [ ] **Step 1: Write the failing tests** — `apps/api/tests/test_auth_rbac.py`:

```python
import json
from pathlib import Path

from typing import get_args

from secureflow_api.auth.rbac import ROLE_PERMISSIONS, permissions_for
from secureflow_api.models import Role

REPO_ROOT = Path(__file__).resolve().parents[3]
CANONICAL = REPO_ROOT / "packages" / "types" / "src" / "role-permissions.json"


def test_matches_canonical_json():
    canonical = json.loads(CANONICAL.read_text())
    assert {role: sorted(perms) for role, perms in canonical.items()} == {
        role: sorted(perms) for role, perms in ROLE_PERMISSIONS.items()
    }


def test_covers_every_role():
    assert set(ROLE_PERMISSIONS) == set(get_args(Role))


def test_permissions_for_unions_roles():
    combined = permissions_for(["developer", "compliance-reviewer"])
    assert "pipeline.trigger" in combined
    assert "compliance.review" in combined
    assert "deployment.approve" not in combined


def test_permissions_for_empty_roles_is_empty():
    assert permissions_for([]) == frozenset()
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_auth_rbac.py -v`
Expected: FAIL — no module `secureflow_api.auth.rbac`

- [ ] **Step 3: Implement** — `auth/rbac.py` (matrix duplicated on purpose; the parity test is the drift guard — runtime never reads across the monorepo):

```python
"""Server-side RBAC matrix. Mirrors packages/types/src/role-permissions.json;
test_auth_rbac.py asserts parity so the two cannot drift silently."""

from collections.abc import Iterable
from typing import Literal

from ..models import Role

Permission = Literal[
    "deployment.approve",
    "deployment.reject",
    "deployment.request-changes",
    "deployment.promote",
    "deployment.rollback",
    "pipeline.retry-stage",
    "pipeline.trigger",
    "risk.accept",
    "finding.update-status",
    "remediation.create",
    "evidence.download",
    "compliance.review",
    "integration.manage",
    "settings.manage",
    "audit.view",
]

_BASE: tuple[Permission, ...] = ("audit.view", "evidence.download")

ROLE_PERMISSIONS: dict[Role, tuple[Permission, ...]] = {
    "developer": (*_BASE, "pipeline.trigger", "pipeline.retry-stage", "remediation.create"),
    "devsecops-engineer": (
        *_BASE,
        "pipeline.trigger",
        "pipeline.retry-stage",
        "finding.update-status",
        "remediation.create",
        "deployment.request-changes",
    ),
    "security-engineer": (
        *_BASE,
        "finding.update-status",
        "risk.accept",
        "remediation.create",
        "deployment.request-changes",
        "deployment.reject",
    ),
    "platform-engineer": (
        *_BASE,
        "pipeline.trigger",
        "pipeline.retry-stage",
        "deployment.rollback",
        "integration.manage",
    ),
    "application-owner": (
        *_BASE,
        "deployment.request-changes",
        "remediation.create",
        "risk.accept",
    ),
    "compliance-reviewer": (*_BASE, "compliance.review"),
    "release-approver": (
        *_BASE,
        "deployment.approve",
        "deployment.reject",
        "deployment.request-changes",
        "deployment.promote",
        "deployment.rollback",
    ),
    "administrator": (
        *_BASE,
        "deployment.approve",
        "deployment.reject",
        "deployment.request-changes",
        "deployment.promote",
        "deployment.rollback",
        "pipeline.retry-stage",
        "pipeline.trigger",
        "risk.accept",
        "finding.update-status",
        "remediation.create",
        "compliance.review",
        "integration.manage",
        "settings.manage",
    ),
}


def permissions_for(roles: Iterable[Role]) -> frozenset[Permission]:
    out: set[Permission] = set()
    for role in roles:
        out.update(ROLE_PERMISSIONS[role])
    return frozenset(out)
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_auth_rbac.py -v`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/secureflow_api/auth/rbac.py apps/api/tests/test_auth_rbac.py
git commit -m "feat(api): python rbac matrix with parity test against canonical json"
```

---

### Task 4: `auth/principal.py`

**Files:**
- Create: `apps/api/src/secureflow_api/auth/principal.py`
- Test: `apps/api/tests/test_auth_principal.py`

**Interfaces:**
- Consumes: `permissions_for`, `Permission` from `auth.rbac` (Task 3).
- Produces: frozen dataclass `Principal(sub: str, name: str, roles: tuple[Role, ...])` with property `permissions -> frozenset[Permission]` and method `require(permission: Permission) -> None` raising `HTTPException(403, detail="forbidden")`; module constant `DEMO_PRINCIPAL = Principal(sub="demo-user", name="You", roles=("administrator",))`.

- [ ] **Step 1: Write the failing tests** — `apps/api/tests/test_auth_principal.py`:

```python
import pytest
from fastapi import HTTPException

from secureflow_api.auth.principal import DEMO_PRINCIPAL, Principal


def test_permissions_derived_from_roles():
    p = Principal(sub="u1", name="Dev", roles=("developer",))
    assert "pipeline.trigger" in p.permissions
    assert "deployment.approve" not in p.permissions


def test_require_passes_when_granted():
    Principal(sub="u1", name="Dev", roles=("developer",)).require("pipeline.trigger")


def test_require_raises_403_when_missing():
    p = Principal(sub="u1", name="Dev", roles=("developer",))
    with pytest.raises(HTTPException) as exc:
        p.require("deployment.approve")
    assert exc.value.status_code == 403
    assert exc.value.detail == "forbidden"


def test_no_roles_means_no_permissions():
    assert Principal(sub="u1", name="X", roles=()).permissions == frozenset()


def test_demo_principal_is_administrator_named_you():
    assert DEMO_PRINCIPAL.name == "You"
    assert "settings.manage" in DEMO_PRINCIPAL.permissions
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_auth_principal.py -v`
Expected: FAIL — no module `secureflow_api.auth.principal`

- [ ] **Step 3: Implement** — `auth/principal.py`:

```python
"""Authenticated caller identity. DEMO_PRINCIPAL is what disabled-mode
requests act as; its name "You" keeps demo output identical to pre-auth."""

from dataclasses import dataclass

from fastapi import HTTPException

from ..models import Role
from .rbac import Permission, permissions_for


@dataclass(frozen=True)
class Principal:
    sub: str
    name: str
    roles: tuple[Role, ...]

    @property
    def permissions(self) -> frozenset[Permission]:
        return permissions_for(self.roles)

    def require(self, permission: Permission) -> None:
        if permission not in self.permissions:
            raise HTTPException(status_code=403, detail="forbidden")


DEMO_PRINCIPAL = Principal(sub="demo-user", name="You", roles=("administrator",))
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_auth_principal.py -v`
Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/secureflow_api/auth/principal.py apps/api/tests/test_auth_principal.py
git commit -m "feat(api): principal with derived permissions and 403 require"
```

---

### Task 5: JWKS fixtures + `auth/jwks.py` + `authenticate()`

**Files:**
- Create: `apps/api/src/secureflow_api/auth/jwks.py`
- Create: `apps/api/src/secureflow_api/auth/dependencies.py` (only `authenticate` and `_unauthorized` this task — FastAPI deps come in Task 6)
- Modify: `apps/api/tests/conftest.py` (append fixtures)
- Test: `apps/api/tests/test_auth_tokens.py`

**Interfaces:**
- Consumes: `AuthConfig` (Task 2), `Principal` (Task 4).
- Produces:
  - `jwks.signing_key_for(token: str, jwks_url: str)` → verification key; internal `_client(url)` is `lru_cache`d.
  - `dependencies.authenticate(token: str, config: AuthConfig) -> Principal` — raises `HTTPException(401, headers={"WWW-Authenticate": "Bearer"})` on any token problem.
  - conftest: session fixtures `auth_keys` (primary+imposter RSA keys), `jwks_document`; function fixtures `make_token(roles=..., *, key, kid, aud, iss, exp_delta, alg, drop)` and `auth_enabled` (sets env + patches JWKS fetch); constants `TEST_TENANT`, `TEST_AUDIENCE`, `TEST_ISSUER`. Tasks 6–8 use `auth_enabled` + `make_token` heavily.

- [ ] **Step 1: Append fixtures to `apps/api/tests/conftest.py`:**

```python
# --- auth fixtures ------------------------------------------------------

TEST_TENANT = "11111111-1111-1111-1111-111111111111"
TEST_AUDIENCE = "api://secureflow-tests"
TEST_ISSUER = f"https://login.microsoftonline.com/{TEST_TENANT}/v2.0"


@pytest.fixture(scope="session")
def auth_keys():
    """(primary, imposter) RSA keypairs. Imposter signs 'wrong key' tokens."""
    from cryptography.hazmat.primitives.asymmetric import rsa

    generate = lambda: rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return generate(), generate()


@pytest.fixture(scope="session")
def jwks_document(auth_keys):
    from jwt.algorithms import RSAAlgorithm

    jwk = RSAAlgorithm.to_jwk(auth_keys[0].public_key(), as_dict=True)
    jwk.update({"kid": "test-key-1", "use": "sig", "alg": "RS256"})
    return {"keys": [jwk]}


@pytest.fixture
def make_token(auth_keys):
    import time

    import jwt as pyjwt

    def _make(
        roles=("administrator",),
        *,
        key=None,
        kid="test-key-1",
        aud=TEST_AUDIENCE,
        iss=TEST_ISSUER,
        exp_delta=300,
        alg="RS256",
        drop=(),
    ):
        now = int(time.time())
        claims = {
            "sub": "user-123",
            "name": "Test User",
            "roles": list(roles),
            "aud": aud,
            "iss": iss,
            "iat": now,
            "exp": now + exp_delta,
        }
        for claim in drop:
            claims.pop(claim)
        return pyjwt.encode(claims, key or auth_keys[0], algorithm=alg, headers={"kid": kid})

    return _make


@pytest.fixture
def auth_enabled(monkeypatch, jwks_document):
    """Turn enforcement on and serve the fixture JWKS without any network:
    PyJWKClient.fetch_data is patched, so kid lookup and key parsing stay real."""
    from jwt import PyJWKClient

    from secureflow_api.auth import jwks as jwks_module

    monkeypatch.setenv("AUTH_ENABLED", "1")
    monkeypatch.setenv("ENTRA_TENANT_ID", TEST_TENANT)
    monkeypatch.setenv("ENTRA_CLIENT_ID", TEST_AUDIENCE)
    monkeypatch.delenv("ENTRA_JWKS_URL", raising=False)
    monkeypatch.setattr(PyJWKClient, "fetch_data", lambda self: jwks_document)
    jwks_module._client.cache_clear()
```

- [ ] **Step 2: Write the failing tests** — `apps/api/tests/test_auth_tokens.py`:

```python
import pytest
from fastapi import HTTPException

from secureflow_api.auth.config import load_auth_config
from secureflow_api.auth.dependencies import authenticate


def _config(auth_enabled):
    return load_auth_config()


def test_valid_token_yields_principal(auth_enabled, make_token):
    principal = authenticate(make_token(roles=["developer"]), load_auth_config())
    assert principal.sub == "user-123"
    assert principal.name == "Test User"
    assert principal.roles == ("developer",)


def test_multiple_roles_union(auth_enabled, make_token):
    principal = authenticate(
        make_token(roles=["developer", "compliance-reviewer"]), load_auth_config()
    )
    assert "compliance.review" in principal.permissions
    assert "pipeline.trigger" in principal.permissions


def test_unknown_roles_ignored(auth_enabled, make_token):
    principal = authenticate(
        make_token(roles=["developer", "galactic-emperor"]), load_auth_config()
    )
    assert principal.roles == ("developer",)


def test_no_valid_roles_yields_permissionless_principal(auth_enabled, make_token):
    principal = authenticate(make_token(roles=[]), load_auth_config())
    assert principal.permissions == frozenset()


def test_name_falls_back_to_sub(auth_enabled, make_token):
    principal = authenticate(make_token(drop=("name",)), load_auth_config())
    assert principal.name == "user-123"


@pytest.mark.parametrize(
    "kwargs",
    [
        {"exp_delta": -120},                       # expired (beyond 60s leeway)
        {"aud": "api://someone-else"},             # wrong audience
        {"iss": "https://evil.example/v2.0"},      # wrong issuer
        {"kid": "no-such-kid"},                    # unknown kid
        {"drop": ("sub",)},                        # missing required claim
    ],
    ids=["expired", "wrong-aud", "wrong-iss", "unknown-kid", "missing-sub"],
)
def test_invalid_tokens_401(auth_enabled, make_token, kwargs):
    with pytest.raises(HTTPException) as exc:
        authenticate(make_token(**kwargs), load_auth_config())
    assert exc.value.status_code == 401
    assert exc.value.headers["WWW-Authenticate"] == "Bearer"


def test_wrong_signing_key_401(auth_enabled, make_token, auth_keys):
    token = make_token(key=auth_keys[1])  # imposter key, same kid
    with pytest.raises(HTTPException) as exc:
        authenticate(token, load_auth_config())
    assert exc.value.status_code == 401


def test_hs256_downgrade_401(auth_enabled, make_token):
    token = make_token(key="shared-secret", alg="HS256")
    with pytest.raises(HTTPException) as exc:
        authenticate(token, load_auth_config())
    assert exc.value.status_code == 401


def test_garbage_token_401(auth_enabled):
    with pytest.raises(HTTPException) as exc:
        authenticate("not.a.jwt", load_auth_config())
    assert exc.value.status_code == 401
```

- [ ] **Step 3: Run to verify failure**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_auth_tokens.py -v`
Expected: FAIL — no module `secureflow_api.auth.dependencies`

- [ ] **Step 4: Implement `auth/jwks.py`:**

```python
"""Cached JWKS clients. The URL is the test seam: tests patch
PyJWKClient.fetch_data so kid lookup and key parsing run for real, offline."""

from functools import lru_cache

from jwt import PyJWKClient


@lru_cache(maxsize=4)
def _client(url: str) -> PyJWKClient:
    return PyJWKClient(url, cache_keys=True)


def signing_key_for(token: str, url: str):
    return _client(url).get_signing_key_from_jwt(token).key
```

- [ ] **Step 5: Implement `auth/dependencies.py`** (validation core only; FastAPI deps land in Task 6):

```python
"""Token validation and (in Task 6) the FastAPI auth dependencies."""

import logging
from typing import get_args

import jwt
from fastapi import HTTPException
from jwt import InvalidTokenError, PyJWKClientError

from ..models import Role
from . import jwks
from .config import AuthConfig
from .principal import Principal

logger = logging.getLogger("secureflow-api")

_KNOWN_ROLES: frozenset[str] = frozenset(get_args(Role))


def _unauthorized() -> HTTPException:
    # Generic detail on purpose: never echo claims or validation specifics.
    return HTTPException(
        status_code=401, detail="invalid_token", headers={"WWW-Authenticate": "Bearer"}
    )


def authenticate(token: str, config: AuthConfig) -> Principal:
    try:
        key = jwks.signing_key_for(token, config.jwks_url)
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=config.client_id,
            issuer=config.issuer,
            leeway=60,
            options={"require": ["exp", "iat", "sub"]},
        )
    except (InvalidTokenError, PyJWKClientError):
        raise _unauthorized() from None
    raw_roles = claims.get("roles") or []
    roles = tuple(r for r in raw_roles if r in _KNOWN_ROLES)
    unknown = [r for r in raw_roles if r not in _KNOWN_ROLES]
    if unknown:
        logger.warning("ignoring unknown roles in token: %s", unknown)
    name = claims.get("name") or claims.get("preferred_username") or claims["sub"]
    return Principal(sub=claims["sub"], name=name, roles=roles)
```

- [ ] **Step 6: Run to verify pass**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_auth_tokens.py -v`
Expected: all PASS (13 tests). If `unknown-kid` raises an unexpected exception type instead of 401, add that exception class to the `except` tuple — PyJWKClient raises `PyJWKClientError` subclasses for kid misses.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/secureflow_api/auth/jwks.py apps/api/src/secureflow_api/auth/dependencies.py apps/api/tests/conftest.py apps/api/tests/test_auth_tokens.py
git commit -m "feat(api): jwt validation core against self-signed jwks fixtures"
```

---

### Task 6: FastAPI dependencies + disabled-mode + fail-fast startup

**Files:**
- Modify: `apps/api/src/secureflow_api/auth/dependencies.py` (append)
- Modify: `apps/api/src/secureflow_api/main.py` (lifespan only, lines ~59-72)
- Test: `apps/api/tests/test_auth_dependencies.py`

**Interfaces:**
- Consumes: `authenticate`, `load_auth_config`, `DEMO_PRINCIPAL` (Tasks 2/4/5).
- Produces (Task 7 wires these into routes):
  - `async get_principal(request: Request) -> Principal` — header-only bearer extraction.
  - `async get_principal_sse(request: Request) -> Principal` — header, then `?access_token=`.
  - `require_permission(permission: Permission)` → dependency returning `Principal`; the returned callable carries attribute `required_permission = permission` (the route-coverage test keys on it).

- [ ] **Step 1: Write the failing tests** — `apps/api/tests/test_auth_dependencies.py`. These call the dependencies directly with a minimal `Request` built from ASGI scope — no route wiring needed yet:

```python
import pytest
from fastapi import HTTPException, Request

from secureflow_api.auth.dependencies import (
    get_principal,
    get_principal_sse,
    require_permission,
)


def _request(headers: dict[str, str] | None = None, query: str = "") -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    return Request(
        {"type": "http", "method": "GET", "path": "/api/x", "headers": raw,
         "query_string": query.encode()}
    )


async def test_disabled_mode_returns_demo_principal(monkeypatch):
    monkeypatch.delenv("AUTH_ENABLED", raising=False)
    principal = await get_principal(_request())
    assert principal.name == "You"
    assert "settings.manage" in principal.permissions


async def test_enabled_missing_header_401(auth_enabled):
    with pytest.raises(HTTPException) as exc:
        await get_principal(_request())
    assert exc.value.status_code == 401
    assert exc.value.headers["WWW-Authenticate"] == "Bearer"


async def test_enabled_valid_bearer(auth_enabled, make_token):
    principal = await get_principal(
        _request({"Authorization": f"Bearer {make_token(roles=['developer'])}"})
    )
    assert principal.roles == ("developer",)


async def test_non_bearer_scheme_401(auth_enabled, make_token):
    with pytest.raises(HTTPException) as exc:
        await get_principal(_request({"Authorization": f"Basic {make_token()}"}))
    assert exc.value.status_code == 401


async def test_sse_accepts_query_token(auth_enabled, make_token):
    principal = await get_principal_sse(
        _request(query=f"access_token={make_token(roles=['developer'])}")
    )
    assert principal.roles == ("developer",)


async def test_sse_prefers_header(auth_enabled, make_token):
    principal = await get_principal_sse(
        _request(
            {"Authorization": f"Bearer {make_token(roles=['developer'])}"},
            query=f"access_token={make_token(roles=['administrator'])}",
        )
    )
    assert principal.roles == ("developer",)


async def test_sse_no_token_401(auth_enabled):
    with pytest.raises(HTTPException) as exc:
        await get_principal_sse(_request())
    assert exc.value.status_code == 401


async def test_plain_get_principal_ignores_query_token(auth_enabled, make_token):
    with pytest.raises(HTTPException) as exc:
        await get_principal(_request(query=f"access_token={make_token()}"))
    assert exc.value.status_code == 401


def test_require_permission_exposes_marker():
    dep = require_permission("deployment.approve")
    assert dep.required_permission == "deployment.approve"
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_auth_dependencies.py -v`
Expected: FAIL — `ImportError: cannot import name 'get_principal'`

- [ ] **Step 3: Append to `auth/dependencies.py`:**

```python
from fastapi import Depends, Request  # merge into existing fastapi import

from .config import load_auth_config  # merge into existing config import
from .principal import DEMO_PRINCIPAL  # merge into existing principal import
from .rbac import Permission


async def get_principal(request: Request) -> Principal:
    config = load_auth_config()
    if not config.enabled:
        return DEMO_PRINCIPAL
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise _unauthorized()
    return authenticate(header[7:], config)


async def get_principal_sse(request: Request) -> Principal:
    """SSE variant: EventSource cannot set headers, so ?access_token= is
    accepted here and nowhere else (RFC 6750 §2.3)."""
    config = load_auth_config()
    if not config.enabled:
        return DEMO_PRINCIPAL
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return authenticate(header[7:], config)
    token = request.query_params.get("access_token")
    if not token:
        raise _unauthorized()
    return authenticate(token, config)


def require_permission(permission: Permission):
    async def dependency(principal: Principal = Depends(get_principal)) -> Principal:
        principal.require(permission)
        return principal

    dependency.required_permission = permission
    return dependency
```

- [ ] **Step 4: Fail-fast + loud log at startup.** In `main.py` lifespan, before the migration call, add:

```python
from .auth.config import load_auth_config  # with the other imports

# first lines of lifespan():
auth_config = load_auth_config()  # raises AuthConfigError on misconfig
if not auth_config.enabled:
    logger.warning(
        "AUTH DISABLED — all routes open. Set AUTH_ENABLED=1 plus "
        "ENTRA_TENANT_ID/ENTRA_CLIENT_ID to enforce bearer auth."
    )
```

- [ ] **Step 5: Run to verify pass (plus no regressions)**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_auth_dependencies.py apps/api/tests/test_auth_config.py -v`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/secureflow_api/auth/dependencies.py apps/api/src/secureflow_api/main.py apps/api/tests/test_auth_dependencies.py
git commit -m "feat(api): fastapi auth dependencies with sse query-token variant"
```

---

### Task 7: Wire every route + route-coverage test

**Files:**
- Modify: `apps/api/src/secureflow_api/main.py` (route decorators)
- Test: `apps/api/tests/test_auth_routes.py`

**Interfaces:**
- Consumes: `get_principal`, `get_principal_sse`, `require_permission` (Task 6); `auth_enabled`/`make_token` fixtures (Task 5).
- Produces: every `/api` route carries an auth dependency. Task 8 relies on `Depends(get_principal)` and `Depends(require_permission(...))` being importable in `main.py` and on route behavior below.

- [ ] **Step 1: Write the failing tests** — `apps/api/tests/test_auth_routes.py`:

```python
import pytest
from fastapi.routing import APIRoute

from secureflow_api.auth import dependencies as authdeps
from secureflow_api.main import app

# Routes whose permission depends on the request body; they authenticate via
# get_principal and check permissions in the handler (Task 8).
HANDLER_CHECKED = {"/api/runs/{run_id}/approval", "/api/audit"}


def _api_routes():
    return [
        r for r in app.routes if isinstance(r, APIRoute) and r.path.startswith("/api")
    ]


def _auth_calls(route):
    return [d.call for d in route.dependant.dependencies]


def test_every_api_route_authenticates():
    for route in _api_routes():
        calls = _auth_calls(route)
        assert any(
            c in (authdeps.get_principal, authdeps.get_principal_sse)
            or getattr(c, "required_permission", None)
            for c in calls
        ), f"unauthenticated route: {route.path}"


def test_every_mutating_route_declares_permission():
    for route in _api_routes():
        if not (route.methods & {"POST", "PATCH"}):
            continue
        calls = _auth_calls(route)
        has_permission = any(getattr(c, "required_permission", None) for c in calls)
        assert has_permission or route.path in HANDLER_CHECKED, (
            f"mutating route without permission: {route.path}"
        )


def test_health_stays_open():
    health = next(r for r in app.routes if isinstance(r, APIRoute) and r.path == "/health")
    assert not _auth_calls(health)


async def test_get_requires_token_when_enabled(auth_enabled, client):
    response = await client.get("/api/applications")
    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"


async def test_get_with_token_ok(auth_enabled, make_token, client):
    response = await client.get(
        "/api/applications",
        headers={"Authorization": f"Bearer {make_token(roles=['compliance-reviewer'])}"},
    )
    assert response.status_code == 200


async def test_retry_permission_enforced(auth_enabled, make_token, client):
    runs = (
        await client.get(
            "/api/runs", headers={"Authorization": f"Bearer {make_token()}"}
        )
    ).json()
    run = runs[0]
    stage = run["stages"][0]
    url = f"/api/runs/{run['id']}/stages/{stage['id']}/retry"
    denied = await client.post(
        url, headers={"Authorization": f"Bearer {make_token(roles=['compliance-reviewer'])}"}
    )
    assert denied.status_code == 403
    allowed = await client.post(
        url, headers={"Authorization": f"Bearer {make_token(roles=['developer'])}"}
    )
    assert allowed.status_code == 204


async def test_promote_permission_enforced(auth_enabled, make_token, client):
    apps_ = (
        await client.get(
            "/api/applications", headers={"Authorization": f"Bearer {make_token()}"}
        )
    ).json()
    url = f"/api/applications/{apps_[0]['id']}/promote"
    body = {"toEnvironment": "production"}
    denied = await client.post(
        url, json=body,
        headers={"Authorization": f"Bearer {make_token(roles=['developer'])}"},
    )
    assert denied.status_code == 403
    allowed = await client.post(
        url, json=body,
        headers={"Authorization": f"Bearer {make_token(roles=['release-approver'])}"},
    )
    assert allowed.status_code == 204


async def test_demo_reset_needs_settings_manage(auth_enabled, make_token, client, monkeypatch):
    monkeypatch.setenv("DEMO_RESET_ENABLED", "1")
    denied = await client.post(
        "/api/demo/reset",
        headers={"Authorization": f"Bearer {make_token(roles=['release-approver'])}"},
    )
    assert denied.status_code == 403


async def test_events_accepts_query_token(auth_enabled, make_token, client):
    token = make_token(roles=["developer"])
    async with client.stream("GET", f"/api/events?access_token={token}") as response:
        assert response.status_code == 200
        async for line in response.aiter_lines():
            assert "hello" in line
            break


async def test_events_rejects_missing_token(auth_enabled, client):
    async with client.stream("GET", "/api/events") as response:
        assert response.status_code == 401


async def test_query_token_rejected_off_sse(auth_enabled, make_token, client):
    response = await client.get(f"/api/applications?access_token={make_token()}")
    assert response.status_code == 401


async def test_disabled_mode_stays_open(client, monkeypatch):
    monkeypatch.delenv("AUTH_ENABLED", raising=False)
    response = await client.get("/api/applications")
    assert response.status_code == 200
```

Note on `test_promote_permission_enforced`: `test_mutations.py::test_promote_moves_version_forward`
already promotes a seeded app with `{"toEnvironment": "production"}` and gets
204 — mirror its app selection if `apps_[0]` turns out not to be promotable.
The assertion that matters here is `403` vs `not-403`.

- [ ] **Step 2: Run to verify failure**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_auth_routes.py -v`
Expected: coverage tests FAIL (routes have no auth dependencies yet)

- [ ] **Step 3: Wire the routes in `main.py`.** Import at top:

```python
from .auth.dependencies import get_principal, get_principal_sse, require_permission
from .auth.principal import Principal
```

Every `GET /api/*` decorator (applications ×2, runs ×2, stage logs, findings ×2, deployments, plans ×2, frameworks ×2, audit, integrations, architecture, approvals list) gains:

```python
@app.get("/api/applications", dependencies=[Depends(get_principal)])
```

The SSE route:

```python
@app.get("/api/events", dependencies=[Depends(get_principal_sse)])
```

Mutating routes get their spec §3 permissions:

```python
@app.post("/api/runs/{run_id}/stages/{stage_id}/retry", status_code=204,
          dependencies=[Depends(require_permission("pipeline.retry-stage"))])
@app.post("/api/applications/{app_id}/sync", status_code=204,
          dependencies=[Depends(require_permission("pipeline.trigger"))])
@app.post("/api/applications/{app_id}/promote", status_code=204,
          dependencies=[Depends(require_permission("deployment.promote"))])
@app.post("/api/applications/{app_id}/rollback", status_code=204,
          dependencies=[Depends(require_permission("deployment.rollback"))])
@app.post("/api/demo/reset", status_code=204,
          dependencies=[Depends(require_permission("settings.manage"))])
```

`POST /api/audit` and `POST /api/runs/{run_id}/approval` get `dependencies=[Depends(get_principal)]` for now — Task 8 moves the approval route to a handler parameter. `PATCH /api/findings/{finding_id}/status` gets `dependencies=[Depends(require_permission("finding.update-status"))]` — Task 8 adds the body-dependent `risk.accept` on top.

- [ ] **Step 4: Run the new tests AND the whole suite**

Run: `uv run --package secureflow-api pytest apps/api/tests -v`
Expected: everything passes. The pre-existing suites (`test_api.py`, `test_mutations.py`, `test_demo_reset.py`, …) run with auth disabled and must be untouched by this change.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/secureflow_api/main.py apps/api/tests/test_auth_routes.py
git commit -m "feat(api): enforce auth and route permissions on every api route"
```

---

### Task 8: Body-dependent permissions — approval decisions, finding risk-accept, decided_by

**Files:**
- Modify: `apps/api/src/secureflow_api/main.py` (`approve_deployment` ~line 298, `update_finding_status` ~line 331)
- Test: `apps/api/tests/test_auth_handlers.py`

**Interfaces:**
- Consumes: `get_principal`, `require_permission`, `Principal` (Tasks 6–7).
- Produces: final handler behavior; nothing downstream.

- [ ] **Step 1: Write the failing tests** — `apps/api/tests/test_auth_handlers.py`:

```python
async def _pick_waiting_run(client, token):
    runs = (
        await client.get("/api/runs", headers={"Authorization": f"Bearer {token}"})
    ).json()
    return next(r for r in runs if r["status"] == "waiting-approval")


def _approval_body(decision):
    return {"decision": decision, "comment": "test", "environment": "production"}


async def test_approve_needs_deployment_approve(auth_enabled, make_token, client):
    admin = make_token()
    run = await _pick_waiting_run(client, admin)
    denied = await client.post(
        f"/api/runs/{run['id']}/approval", json=_approval_body("approved"),
        headers={"Authorization": f"Bearer {make_token(roles=['developer'])}"},
    )
    assert denied.status_code == 403


async def test_reject_allowed_for_security_engineer(auth_enabled, make_token, client):
    admin = make_token()
    run = await _pick_waiting_run(client, admin)
    response = await client.post(
        f"/api/runs/{run['id']}/approval", json=_approval_body("rejected"),
        headers={"Authorization": f"Bearer {make_token(roles=['security-engineer'])}"},
    )
    assert response.status_code == 204


async def test_approve_records_principal_name(auth_enabled, make_token, client):
    approver = make_token(roles=["release-approver"])
    run = await _pick_waiting_run(client, approver)
    response = await client.post(
        f"/api/runs/{run['id']}/approval", json=_approval_body("approved"),
        headers={"Authorization": f"Bearer {approver}"},
    )
    assert response.status_code == 204
    approvals = (
        await client.get(
            f"/api/runs/{run['id']}/approvals",
            headers={"Authorization": f"Bearer {approver}"},
        )
    ).json()
    decided = [a for a in approvals if a["decision"] == "approved"]
    assert decided and decided[0]["decidedBy"] == "Test User"


async def test_changes_requested_permission(auth_enabled, make_token, client):
    admin = make_token()
    run = await _pick_waiting_run(client, admin)
    denied = await client.post(
        f"/api/runs/{run['id']}/approval", json=_approval_body("changes-requested"),
        headers={"Authorization": f"Bearer {make_token(roles=['compliance-reviewer'])}"},
    )
    assert denied.status_code == 403


async def test_accepted_risk_needs_risk_accept(auth_enabled, make_token, client):
    admin = make_token()
    findings = (
        await client.get("/api/findings", headers={"Authorization": f"Bearer {admin}"})
    ).json()
    finding_id = findings[0]["id"]
    # devsecops-engineer HAS finding.update-status but NOT risk.accept
    devsecops = make_token(roles=["devsecops-engineer"])
    denied = await client.patch(
        f"/api/findings/{finding_id}/status",
        json={"status": "accepted-risk", "reason": "test"},
        headers={"Authorization": f"Bearer {devsecops}"},
    )
    assert denied.status_code == 403
    allowed_other_status = await client.patch(
        f"/api/findings/{finding_id}/status",
        json={"status": "resolved", "reason": "test"},
        headers={"Authorization": f"Bearer {devsecops}"},
    )
    assert allowed_other_status.status_code == 204
    security = make_token(roles=["security-engineer"])
    allowed = await client.patch(
        f"/api/findings/{finding_id}/status",
        json={"status": "accepted-risk", "reason": "test"},
        headers={"Authorization": f"Bearer {security}"},
    )
    assert allowed.status_code == 204
```

Check the actual approval JSON field name before asserting: the API models use
Pydantic alias generation — look at `models.py` `Approval` (`decided_by` field)
and how existing tests read it (`test_api.py` or `test_mutations.py`). If the
wire name is `decidedBy` keep the test as written; if it is `decided_by`,
adjust.

- [ ] **Step 2: Run to verify failure**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_auth_handlers.py -v`
Expected: FAIL — decision permissions not enforced (all decisions currently succeed for any authenticated principal), `decidedBy` is `"You"`.

- [ ] **Step 3: Implement in `main.py`.** `approve_deployment` gains a principal parameter and the decision map; `decided_by` uses the principal:

```python
_DECISION_PERMISSION: dict[str, str] = {
    "approved": "deployment.approve",
    "rejected": "deployment.reject",
    "changes-requested": "deployment.request-changes",
}


@app.post("/api/runs/{run_id}/approval", status_code=204)
async def approve_deployment(
    run_id: str,
    body: ApprovalBody,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
) -> None:
    principal.require(_DECISION_PERMISSION[body.decision])
    ...
    # in the pending-approval branch:
    pending.decided_by = principal.name
```

(The `...` body is otherwise unchanged — only the `decided_by = "You"` line changes.)

`update_finding_status` keeps its route-level `require_permission("finding.update-status")` from Task 7 and consumes the returned principal for the extra check:

```python
@app.patch("/api/findings/{finding_id}/status", status_code=204)
async def update_finding_status(
    finding_id: str,
    body: FindingStatusBody,
    principal: Principal = Depends(require_permission("finding.update-status")),
    session: AsyncSession = Depends(get_session),
) -> None:
    if body.status == "accepted-risk":
        principal.require("risk.accept")
    ...
```

Move the dependency from the decorator into the parameter as shown (the coverage test accepts either position — `dependant.dependencies` covers both).

- [ ] **Step 4: Run new tests + full suite**

Run: `uv run --package secureflow-api pytest apps/api/tests -v`
Expected: all pass, including disabled-mode suites — `DEMO_PRINCIPAL.name == "You"` keeps `decided_by` output identical when auth is off.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/secureflow_api/main.py apps/api/tests/test_auth_handlers.py
git commit -m "feat(api): decision-mapped approval permissions and risk-accept gate"
```

---

### Task 9: Documentation

**Files:**
- Modify: `docs/security-model.md`
- Modify: `docs/deployment.md`
- Modify: `docs/threat-model.md`

**Interfaces:** none — prose only.

- [ ] **Step 1: `docs/security-model.md`.** Replace the "Production auth plan (not yet implemented)" section (~line 59) with an implemented section. Content requirements: bearer JWT validation implemented behind `AUTH_ENABLED` (default off, demo posture unchanged); Entra **app roles** claim carries `Role` values directly (deviation from the earlier group-claims wording — say so); server-side `ROLE_PERMISSIONS` enforced per route with a coverage test; placeholder tenant — validation tested against self-signed JWKS fixtures, no real tenant configured; SPA still uses the role switcher and sends no tokens, so enabling enforcement without a real tenant + MSAL breaks the SPA (documented as expected). Also update the role-switcher caveat at ~line 51 to point at `AUTH_ENABLED`.

- [ ] **Step 2: `docs/deployment.md`.** In the environment-variable documentation, add a table/rows for: `AUTH_ENABLED` (default `0`; `1` enforces bearer auth and requires the rest), `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID` (JWT audience), `ENTRA_JWKS_URL` (optional override; defaults to the tenant's discovery keys URL). Note fail-fast startup behavior.

- [ ] **Step 3: `docs/threat-model.md`.** Add the SSE residual risk: `?access_token=` on `/api/events` can land in access logs; accepted because EventSource cannot send headers; mitigations — short token lifetime (Entra default ~1h), TLS-only, no query logging on the API itself, endpoint is read-only events.

- [ ] **Step 4: Verify docs render and no stale claims remain**

Run: `grep -rn "not yet implemented" docs/security-model.md`
Expected: no match. Skim the three diffs for contradictions with the spec.

- [ ] **Step 5: Commit**

```bash
git add docs/security-model.md docs/deployment.md docs/threat-model.md
git commit -m "docs: entra jwt validation and rbac enforcement documented"
```

---

### Task 10: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Full API suite**

Run: `uv run --package secureflow-api pytest apps/api/tests`
Expected: all pass.

- [ ] **Step 2: Web side**

Run: `pnpm -r typecheck && pnpm --filter @secureflow/web test && pnpm --filter @secureflow/web lint`
Expected: all pass.

- [ ] **Step 3: Manual smoke — disabled mode is byte-identical**

Run: `docker-compose up -d && uv run --package secureflow-api secureflow-api &` then `curl -s localhost:4000/api/applications | head -c 200; curl -s -o /dev/null -w "%{http_code}" localhost:4000/health`
Expected: JSON payload and `200` — no auth prompts. Kill the server afterward.

- [ ] **Step 4: Manual smoke — misconfig fails fast**

Run: `AUTH_ENABLED=1 uv run --package secureflow-api secureflow-api`
Expected: process exits with `AuthConfigError: AUTH_ENABLED=1 but not set: ENTRA_TENANT_ID, ENTRA_CLIENT_ID`.

- [ ] **Step 5: Done — hand back for review**

No commit. Use superpowers:finishing-a-development-branch / requesting-code-review flow per session convention.
