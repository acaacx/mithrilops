# Postgres persistence for the SecureFlow API

Status: design approved, not yet implemented
Date: 2026-08-02

## Problem

`apps/api/src/secureflow_api/state.py` holds the entire API dataset in a module
global, seeded from JSON fixtures on first access. It works, and its own
docstring names the successor: "Extension point: replace with PostgreSQL +
SQLAlchemy repositories."

The consequences of the current design:

- State is per-process and dies on restart. Every approval, promotion,
  rollback, and finding transition the demo produces is lost.
- State is per-replica. More than one Container App replica means users see
  different data depending on which one answers.
- The one piece of infrastructure a "secure delivery control center" is most
  expected to have — a real database, with migrations, backups, and private
  networking — is the one piece it does not have. The Terraform module for
  PostgreSQL Flexible Server already exists and is unused.

## Goals

- Every one of the ten entity collections persists in PostgreSQL.
- Restarting the API preserves state; a guarded reset restores the demo.
- The simulator, request handlers, and tests all work against a real database.
- Migrations are the deployed artifact and are exercised in CI.

## Non-goals

- System-of-record semantics. This is a demo-stateful application: the database
  auto-seeds from fixtures when empty. Real integrations can layer on later.
- Multi-replica SSE fan-out. See "Known limitations".
- Entra token authentication to Postgres. Password auth via Key Vault ships
  first; the module already has `active_directory_auth_enabled = true` waiting.
- Reworking the postgres Terraform module for optional private networking.
  Tracked as a follow-up; see "Infrastructure".

---

## 1. Storage model

**Approach: hybrid typed columns + JSONB payload.** One table per entity. Each
row carries `payload JSONB NOT NULL` holding the complete serialized Pydantic
model, plus typed columns for every field used as a filter, join key, or sort
key. Typed columns are derived from the payload on write, so the payload stays
the single source of truth and the typed columns can never be the thing someone
forgets to update.

Rejected alternatives:

- **Pure document store** — everything through JSONB operators. Loses index
  ergonomics and makes the common `?applicationId=` filters awkward for no gain.
- **Full relational normalization** — roughly 30 tables to model stages, findings
  refs, compliance mappings, resource changes, and diagram nodes/edges. No
  current query needs it, and the Pydantic models are already the schema.

### Tables and typed columns

| Table | Typed columns beyond `id` and `payload` |
|---|---|
| `applications` | — |
| `runs` | `application_id`, `status`, `environment`, `started_at` |
| `approvals` | `run_id`, `decision` |
| `findings` | `application_id`, `severity`, `status` |
| `deployments` | `application_id`, `environment`, `status` |
| `plans` | `application_id` |
| `frameworks` | — |
| `audit` | `timestamp`, `actor`, `target_type` |
| `integrations` | — |
| `diagrams` | `application_id` |

Indexes follow the typed columns: `runs(application_id)`, `runs(started_at desc)`,
`findings(application_id, severity)`, `approvals(run_id)`, `audit(timestamp desc)`.

### Audit ids

`CREATE SEQUENCE audit_id_seq START 101`. Fixture rows keep their literal
`aud-1..aud-10` ids; runtime ids are `'aud-' || nextval('audit_id_seq')`. This
preserves the existing convention — the SPA mock counter starts at the same
place, and `test_state.py` asserts the first runtime id is `aud-101`.

---

## 2. Code structure

### New package: `apps/api/src/secureflow_api/db/`

| Module | Contents |
|---|---|
| `engine.py` | Async engine, `async_sessionmaker`, `DATABASE_URL` handling |
| `session.py` | `get_session` FastAPI dependency; the override point for tests |
| `tables.py` | SQLAlchemy table definitions |
| `repositories.py` | One repository per entity: `list`, `get`, `save`, plus the filters the routes need |
| `seed.py` | `ensure_seeded(session)`, `reset_demo(session)` |

Alembic lives at `apps/api/alembic/` with the initial revision creating all ten
tables, the indexes, and `audit_id_seq`.

`repositories.py` owns the payload↔typed-column derivation. A `save` serializes
the model to `payload` and recomputes every typed column from it in the same
statement. Reads deserialize `payload` back into the Pydantic model; typed
columns are for the `WHERE` clause, never for reconstructing the object.

### Changes to existing modules

- **`state.py` is deleted.** `AppState`, `get_state`, `reset_state`, and
  `audit_counter` all go. There is no in-memory fallback to keep alongside.
- **`now_iso` moves to a new `clock.py`** — it is a utility, not state.
- **`record_audit` moves into the audit repository**, taking a session instead of
  an `AppState` and using the sequence instead of a counter.
- **`data.py` survives, demoted to seed source.** Nothing at runtime reads it.
- **`main.py`** rewires roughly 25 `state.get_state()` call sites (see the route
  list in `main.py`) to repository calls through an injected session.
- **`simulator.py`** takes its own per-tick session; see section 3.
- **`logs.py` is untouched.** Stage logs stay generated from timestamps and are
  never stored.

### Dependencies

Added to `apps/api/pyproject.toml`: `sqlalchemy[asyncio]>=2.0`, `asyncpg`,
`alembic`. Dev group: `pytest-asyncio`.

New root `docker-compose.yml` with a single `db` service on `postgres:17-alpine`,
a named volume, and a `pg_isready` healthcheck.

---

## 3. Seed, reset, and the simulator

### 3.1 Seeding

`ensure_seeded(session)` runs once in the FastAPI `lifespan`, after migrations
and before the simulator task starts.

The guard is a one-row `demo_seed` table (`seeded_at timestamptz`), not a row
count — a demo where the user deleted every run must not silently reseed.

1. `SELECT pg_advisory_xact_lock(<constant>)`, so replicas booting together
   serialize here instead of double-seeding.
2. If `demo_seed` has a row, return.
3. Insert all ten collections from the `data.py` fixtures, insert `demo_seed`,
   commit.

### 3.2 Reset

`POST /api/demo/reset` replaces `reset_state()`.

- Gated by `DEMO_RESET_ENABLED` (default `true` locally, `false` in production).
  When disabled the route returns 404, not 403 — production does not advertise
  an endpoint it will not serve.
- One transaction: `TRUNCATE <all tables> RESTART IDENTITY CASCADE`,
  `setval('audit_id_seq', 100)`, re-run the seed, `simulator.reset()`.
- Then broadcast a new `state-reset` SSE event so connected SPAs refetch
  instead of rendering rows that no longer exist.

### 3.3 Simulator against a real database

Four changes, all forced by the move off in-process state.

**A session per tick.** `tick(state)` becomes `async def tick(session)`. The loop
opens a session per tick and commits at the end. No session and no ORM object
survives across ticks — the current code holds `AppState` object references and
mutates them in place, which cannot work once each tick is its own transaction.

**Re-read under a row lock.** Each tick begins with
`SELECT ... FROM runs WHERE id = 'run-0512' FOR UPDATE`. The simulated run is the
one row both the simulator and the request handlers write, so locking it turns
the only real race into serialization.

Everywhere else is last-write-wins. That is acceptable at demo scale and is
stated here deliberately rather than left implicit.

**Stage mutation goes through the payload.** Stages live inside `runs.payload`.
A tick reads the whole run into the Pydantic model, mutates it exactly as the
current code does, and calls `repo.save(run)`, which writes the payload and
re-derives the typed columns. The body of `tick` is otherwise unchanged.

**`_idle_ticks` becomes derived, not stored.** The module-global counter is
process state: it dies on restart and breaks with more than one replica. Replace
it with a timestamp check — if `status == "succeeded"` and
`now - finished_at > IDLE_SECONDS`, restart the run. Same behavior, stateless,
and consistent with `logs.py`, which already derives from timestamps.

**One ticker.** The loop takes a session-level `pg_try_advisory_lock` at startup
and skips ticking if it does not get it. Whichever replica wins drives the demo.

### Known limitations

SSE broadcast is in-process, and Redis was cut from the stack. With more than one
replica, only clients connected to the ticking replica receive live events. Dev
runs a single replica. If that changes, the fix is Postgres `LISTEN/NOTIFY`, not
reintroducing Redis.

---

## 4. Testing

Real PostgreSQL. `docker compose up -d db` locally, against a separate
`secureflow_test` database. SQLite was rejected outright: dialect drift on JSONB,
sequences, and `FOR UPDATE` would make the tests lie about exactly the mechanisms
this design depends on. testcontainers was considered and not chosen — compose
locally plus a service container in CI is fewer moving parts.

### Fixtures

Session scope: create the engine, run `alembic upgrade head` (not
`metadata.create_all` — the migrations are what ships, so the migrations are what
the tests exercise), seed once.

Per test: an outer connection opens a transaction; the session is bound to it
with `join_transaction_mode="create_savepoint"`; the `get_session` dependency is
overridden to yield that session; teardown rolls back.

Rollback-per-test was chosen over truncate-and-reseed: reinserting ten
collections per test gets slow quickly. A separate `truncate_and_reseed` fixture
stays available for the few tests that need real commit semantics — the seed
guard and the reset endpoint.

`pytest-asyncio` runs with `asyncio_mode = "auto"`.

### Test file changes

| File | Change |
|---|---|
| `tests/conftest.py` | Rewritten; the autouse `fresh_state` fixture is gone |
| `tests/test_state.py` | Deleted, replaced by `tests/test_repositories.py` |
| `tests/test_simulator.py` | Async, ticks against a session |
| `tests/test_api.py`, `tests/test_mutations.py` | Largely unchanged — same client, overridden dependency |

New coverage worth having:

- A table-driven test asserting every typed column equals its source payload
  field after `save`. Payload/column drift is this design's one real failure
  mode, so it gets a dedicated test per table.
- Seed idempotency: a second `ensure_seeded` call is a no-op.
- Reset restores the audit sequence — the first post-reset event is `aud-101`.

There is no skip-if-no-database marker. Postgres is required; if
`TEST_DATABASE_URL` is unreachable the suite fails with a clear message. A suite
that skips itself green is a suite that lies.

---

## 5. CI

Two jobs in `.github/workflows/ci.yml` need a service container, not one.

**`quality`** — add:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    env:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: secureflow_test
    ports: ['5432:5432']
    options: >-
      --health-cmd pg_isready --health-interval 10s
      --health-timeout 5s --health-retries 5
```

with `TEST_DATABASE_URL: postgresql+asyncpg://postgres:postgres@localhost:5432/secureflow_test`
on the pytest step.

**`e2e-http`** — the same service block, plus `DATABASE_URL`. This job boots the
real API: `apps/web/playwright.http.config.ts` starts `uv run secureflow-api` as
a `webServer`, so the API now needs a database before the suite can run. The
connection string goes in that `webServer` entry's `env` block, alongside the
existing `SIM_TICK_SECONDS`, so the same command works locally and in CI. This is
the easiest step to overlook and fails confusingly when missed.

One new step after the tests: `alembic check`, which fails when `tables.py` has
drifted from the migration history. Cheap protection against a model edit landing
without a revision.

No new secrets. Nothing here is conditional on Azure access.

---

## 6. Infrastructure

`infrastructure/modules/postgres/` already exists and is in good shape: HA,
35-day geo-redundant backups, Entra auth enabled, public network access off.

- **Version:** the module pins `version = "16"`. Change to `17` to match
  `docker-compose.yml`. Nothing is deployed yet, so aligning now is free.
- **App config:** `DATABASE_URL` flows Key Vault → Container App secret → env
  var, using password auth. The managed-identity path (an Entra token used as
  the password via `azure-identity`) is a separate, later change.
- **Migrations on deploy:** `alembic upgrade head` runs in the container
  entrypoint before uvicorn, under an advisory lock so replicas serialize. A
  separate Container Apps job is cleaner in principle and more moving parts in
  practice; at this scale the entrypoint wins.
- **`.env.example`:** define `DATABASE_URL`, add `TEST_DATABASE_URL`,
  `DEMO_RESET_ENABLED`, and `SIMULATOR_ENABLED`. Delete `REDIS_URL` — Redis was
  cut, and leaving the line invites someone to wire against it.

### Follow-up, explicitly out of scope

The postgres module is hard-wired to private networking:
`delegated_subnet_id`, `private_dns_zone_id`, and
`public_network_access_enabled = false`. This contradicts the
`enable_private_networking` gate agreed for the rest of the Azure footprint.
Supporting both modes means public access plus a firewall rule for the Container
Apps egress when the gate is off. Real work, deliberately not part of this
change — recorded here so it is not discovered at first deploy.

### Documentation

`docs/local-development.md` gains a database section, `docs/architecture.md` and
`docs/deployment.md` gain the storage story, and `docs/security-model.md` gains a
line on the reset endpoint being demo-gated and absent in production.

---

## Decisions recorded

- Hybrid typed columns + JSONB, not a document store and not full normalization.
- All ten collections go to Postgres, including the five that look static. One
  storage story, one seed path; integrations will mutate several of them anyway.
- Postgres is required. `state.py` is deleted, not kept as a fallback. The SPA's
  memory mode still exists for pure-frontend demos and never touches the API.
- The "missing config → fall back to a loudly logged mock" rule applies to
  external integrations (GitHub, Argo, LLM), where credentials are genuinely
  absent. It does not apply to storage.
- PostgreSQL 17 in both compose and Terraform.
- Rollback-per-test, not truncate-and-reseed.
- The private-networking gate on the postgres module is a follow-up.
