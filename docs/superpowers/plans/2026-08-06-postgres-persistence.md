# Postgres Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-memory `state.py` module with PostgreSQL persistence (hybrid typed columns + JSONB payload) for all ten entity collections, including seed/reset, a DB-backed simulator, real-Postgres tests, and CI wiring.

**Architecture:** One table per entity: `payload JSONB NOT NULL` holds the complete serialized Pydantic model; typed columns (derived from the payload on every write) exist only for filters/joins/sorts. New package `apps/api/src/secureflow_api/db/` with engine, tables, repositories, seed, and session dependency. Alembic owns the schema. `state.py` is deleted — Postgres is required, no fallback.

**Tech Stack:** FastAPI, SQLAlchemy 2 (async, Core tables), asyncpg, Alembic, PostgreSQL 17, pytest-asyncio, httpx ASGITransport.

**Spec:** `docs/superpowers/specs/2026-08-02-postgres-persistence-design.md`

## Global Constraints

- Python `>=3.12`; run everything through uv from the **repo root**: `uv run --package secureflow-api <cmd>`.
- API tests: `uv run --package secureflow-api pytest apps/api/tests` (CI runs exactly this).
- PostgreSQL **17** everywhere (compose, CI service, Terraform). No SQLite, no skip-if-no-database markers — an unreachable DB is a test failure.
- Payload JSON is stored **camelCase** (`model_dump(mode="json", by_alias=True)`) — identical to the wire contract and the JSON fixtures in `apps/api/data/*.json`.
- Typed columns are always derived from the payload in the same write; never written independently.
- Audit ids: fixtures keep `aud-1..aud-10`; runtime ids are `'aud-' || nextval('audit_id_seq')`, sequence starts at 101.
- Existing env var names stay: `SIM_ENABLED`, `SIM_TICK_SECONDS`. New: `DATABASE_URL`, `TEST_DATABASE_URL`, `DEMO_RESET_ENABLED`, `SIM_IDLE_SECONDS`.
- Local default `DATABASE_URL`: `postgresql+asyncpg://postgres:postgres@localhost:5432/secureflow`; tests default `TEST_DATABASE_URL`: `postgresql+asyncpg://postgres:postgres@localhost:5432/secureflow_test`.
- List ordering contract: every list endpoint returns rows in fixture/insertion order via a `seq` identity column — **except** `/api/audit`, which orders `timestamp DESC, seq DESC` (newest first, matching today's `insert(0)` behavior).
- Deviation from spec §6, on purpose: migrations run in the FastAPI **lifespan** (via `asyncio.to_thread(alembic upgrade head)`, serialized by an advisory lock inside `alembic/env.py`), not in the container entrypoint. One code path covers local dev, the Playwright `webServer`, and the container.
- Commit after every task. Working tree currently carries `handoff.md` and the spec — leave them uncommitted unless a task says otherwise.
- **Sequence trap:** Postgres sequences are non-transactional. Rollback-per-test does NOT restore `audit_id_seq`. Any test asserting a specific `aud-N` id must `setval('audit_id_seq', 100)` itself first.

---

### Task 1: Compose, dependencies, clock

**Files:**
- Create: `docker-compose.yml` (repo root)
- Create: `docker/initdb/create-test-db.sql`
- Create: `apps/api/src/secureflow_api/clock.py`
- Modify: `apps/api/pyproject.toml`
- Modify: `.env.example`
- Test: `apps/api/tests/test_clock.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `clock.now_iso() -> str` (ISO-8601 UTC, milliseconds, `Z` suffix — exact move of `state.now_iso`). A running Postgres 17 with databases `secureflow` and `secureflow_test`. Deps `sqlalchemy[asyncio]`, `asyncpg`, `alembic`, `pytest-asyncio` installed and locked.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_clock.py
import re

from secureflow_api.clock import now_iso


def test_now_iso_shape():
    value = now_iso()
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_clock.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'secureflow_api.clock'`

- [ ] **Step 3: Create `clock.py`**

```python
# apps/api/src/secureflow_api/clock.py
"""Time source for the API. Kept apart from storage so it survives state.py's removal."""

from datetime import datetime, timezone


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
```

Do NOT delete `state.now_iso` yet — later tasks migrate its callers, Task 8 deletes the module.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_clock.py -v`
Expected: PASS

- [ ] **Step 5: Add dependencies**

In `apps/api/pyproject.toml`, extend `dependencies`:

```toml
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "sqlalchemy[asyncio]>=2.0",
    "asyncpg>=0.30",
    "alembic>=1.14",
]
```

extend the dev group:

```toml
dev = [
    "pytest>=8",
    "pytest-asyncio>=0.25",
    "httpx>=0.27",
]
```

and extend `[tool.pytest.ini_options]`:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
```

Then run: `uv sync --all-packages` (regenerates `uv.lock`). Expected: resolves cleanly.

- [ ] **Step 6: Create compose file and init script**

```yaml
# docker-compose.yml
# Local Postgres for the API. `docker compose up -d db` is the one command
# the API and its tests require. Data survives restarts in the named volume.
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: secureflow
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/initdb:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  pgdata:
```

```sql
-- docker/initdb/create-test-db.sql
-- The pytest suite runs against a separate database on the same server.
CREATE DATABASE secureflow_test;
```

Run: `docker compose up -d db` then `docker compose exec db psql -U postgres -c '\l' | grep secureflow`
Expected: both `secureflow` and `secureflow_test` listed. (If the volume predates the init script: `docker compose down -v` first — init scripts only run on empty volumes.)

- [ ] **Step 7: Update `.env.example`**

In the `# --- API ---` section add:

```bash
# PostgreSQL connection (required — the API has no in-memory fallback).
# docker-compose.yml provides this server; the default matches it.
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/secureflow
# Used by pytest; a separate database on the same server.
TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/secureflow_test
# POST /api/demo/reset exists only when enabled (default on locally, off in prod).
DEMO_RESET_ENABLED=1
# Simulator: SIM_ENABLED=0 disables it entirely; idle pause between demo runs.
SIM_IDLE_SECONDS=35
```

In the `# --- Future integrations ---` block delete the `# REDIS_URL=` and `# DATABASE_URL=` lines (Redis was cut from the stack; DATABASE_URL is no longer a future placeholder).

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml docker/initdb apps/api/src/secureflow_api/clock.py apps/api/tests/test_clock.py apps/api/pyproject.toml uv.lock .env.example
git commit -m "feat(api): postgres groundwork — compose, deps, clock module"
```

---

### Task 2: Tables, engine, Alembic

**Files:**
- Create: `apps/api/src/secureflow_api/db/__init__.py` (empty)
- Create: `apps/api/src/secureflow_api/db/engine.py`
- Create: `apps/api/src/secureflow_api/db/tables.py`
- Create: `apps/api/src/secureflow_api/db/migrate.py`
- Create: `apps/api/alembic.ini`
- Create: `apps/api/alembic/env.py`
- Create: `apps/api/alembic/script.py.mako`
- Create: `apps/api/alembic/versions/0001_initial_schema.py`
- Test: `apps/api/tests/test_migrations.py`

**Interfaces:**
- Consumes: running Postgres from Task 1.
- Produces:
  - `engine.database_url() -> str`, `engine.get_engine() -> AsyncEngine`, `engine.get_sessionmaker() -> async_sessionmaker[AsyncSession]`, `await engine.dispose_engine() -> None`
  - `tables.metadata: MetaData`; `tables.applications/runs/approvals/findings/deployments/plans/frameworks/audit/integrations/diagrams/demo_seed: Table`; `tables.audit_id_seq: Sequence`; `tables.ENTITY_TABLES: dict[str, Table]` (the ten entity tables, keyed by name, insertion-ordered)
  - `migrate.upgrade_to_head() -> None` (sync; call via `asyncio.to_thread`)

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_migrations.py
import os

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@localhost:5432/secureflow_test",
)

EXPECTED_TABLES = {
    "applications", "runs", "approvals", "findings", "deployments",
    "plans", "frameworks", "audit", "integrations", "diagrams",
    "demo_seed", "alembic_version",
}


async def test_upgrade_head_creates_schema():
    import asyncio

    from secureflow_api.db import migrate

    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    await asyncio.to_thread(migrate.upgrade_to_head)

    engine = create_async_engine(TEST_DATABASE_URL)
    try:
        async with engine.connect() as conn:
            names = await conn.run_sync(lambda sc: set(inspect(sc).get_table_names()))
            assert EXPECTED_TABLES <= names
            nxt = (await conn.execute(text("SELECT nextval('audit_id_seq')"))).scalar_one()
            assert nxt >= 101
            cols = await conn.run_sync(
                lambda sc: {c["name"] for c in inspect(sc).get_columns("runs")}
            )
            assert {"id", "seq", "payload", "application_id", "status", "environment", "started_at"} <= cols
    finally:
        await engine.dispose()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_migrations.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'secureflow_api.db'`

- [ ] **Step 3: Create `engine.py`**

```python
# apps/api/src/secureflow_api/db/engine.py
"""Async engine and sessionmaker, created lazily from DATABASE_URL.

Postgres is required: there is no in-memory fallback. A missing or
unreachable database is a startup failure, not a silent degradation.
"""

import os

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def database_url() -> str:
    return os.environ.get(
        "DATABASE_URL",
        "postgresql+asyncpg://postgres:postgres@localhost:5432/secureflow",
    )


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_async_engine(database_url(), pool_pre_ping=True)
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    global _sessionmaker
    if _sessionmaker is None:
        _sessionmaker = async_sessionmaker(get_engine(), expire_on_commit=False)
    return _sessionmaker


async def dispose_engine() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None
```

- [ ] **Step 4: Create `tables.py`**

```python
# apps/api/src/secureflow_api/db/tables.py
"""Hybrid storage schema: payload JSONB is the source of truth; typed columns
exist only for WHERE/ORDER BY and are re-derived from the payload on every
write (see repositories.py). `seq` is an identity column preserving fixture
insertion order — the list-endpoint ordering contract.
"""

from sqlalchemy import BigInteger, Column, Identity, MetaData, Sequence, Table, Text
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP

metadata = MetaData()

# Runtime audit ids continue after the aud-1..aud-10 fixture range.
audit_id_seq = Sequence("audit_id_seq", start=101, metadata=metadata)


def _entity_table(name: str, *extra: Column) -> Table:
    return Table(
        name,
        metadata,
        Column("id", Text, primary_key=True),
        Column("seq", BigInteger, Identity(always=True), nullable=False, unique=True),
        Column("payload", JSONB, nullable=False),
        *extra,
    )


applications = _entity_table("applications")
runs = _entity_table(
    "runs",
    Column("application_id", Text, nullable=False, index=True),
    Column("status", Text, nullable=False),
    Column("environment", Text, nullable=False),
    Column("started_at", TIMESTAMP(timezone=True), nullable=False, index=True),
)
approvals = _entity_table(
    "approvals",
    Column("run_id", Text, nullable=False, index=True),
    Column("decision", Text, nullable=False),
)
findings = _entity_table(
    "findings",
    Column("application_id", Text, nullable=False, index=True),
    Column("severity", Text, nullable=False),
    Column("status", Text, nullable=False),
)
deployments = _entity_table(
    "deployments",
    Column("application_id", Text, nullable=False, index=True),
    Column("environment", Text, nullable=False),
    Column("status", Text, nullable=False),
)
plans = _entity_table("plans", Column("application_id", Text, nullable=False, index=True))
frameworks = _entity_table("frameworks")
audit = _entity_table(
    "audit",
    Column("timestamp", TIMESTAMP(timezone=True), nullable=False, index=True),
    Column("actor", Text, nullable=False),
    Column("target_type", Text, nullable=False),
)
integrations = _entity_table("integrations")
diagrams = _entity_table("diagrams", Column("application_id", Text, nullable=False, index=True))

# Seed guard: one row means "this database has been seeded" — deliberately not
# a row count, so a demo where every run was deleted does not silently reseed.
demo_seed = Table(
    "demo_seed",
    metadata,
    Column("seeded_at", TIMESTAMP(timezone=True), primary_key=True),
)

ENTITY_TABLES: dict[str, Table] = {
    "applications": applications,
    "runs": runs,
    "approvals": approvals,
    "findings": findings,
    "deployments": deployments,
    "plans": plans,
    "frameworks": frameworks,
    "audit": audit,
    "integrations": integrations,
    "diagrams": diagrams,
}
```

- [ ] **Step 5: Create Alembic scaffold**

```ini
# apps/api/alembic.ini
[alembic]
script_location = %(here)s/alembic
```

```python
# apps/api/alembic/env.py
"""Async Alembic environment. DATABASE_URL comes from the environment — the
same variable the app uses. An advisory transaction lock serializes replicas
that migrate concurrently at boot.
"""

import asyncio

from alembic import context
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from secureflow_api.db import engine as app_engine
from secureflow_api.db.tables import metadata

MIGRATION_LOCK_KEY = 715002

target_metadata = metadata


def do_run_migrations(connection) -> None:
    connection.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": MIGRATION_LOCK_KEY})
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = create_async_engine(app_engine.database_url())
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    raise SystemExit("offline migrations are not supported")
run_migrations_online()
```

```mako
# apps/api/alembic/script.py.mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}
"""
from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

- [ ] **Step 6: Write the initial migration**

Generate against the freshly defined metadata (autogenerate needs a reachable DB):

```bash
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/secureflow_test \
  uv run --package secureflow-api alembic -c apps/api/alembic.ini revision --autogenerate -m "initial schema"
```

Rename the generated file to `apps/api/alembic/versions/0001_initial_schema.py`. Review it: it must create all eleven tables, the typed-column indexes, and it will NOT include `audit_id_seq` (autogenerate does not track standalone sequences) — add it by hand:

```python
def upgrade() -> None:
    op.execute(sa.schema.CreateSequence(sa.Sequence("audit_id_seq", start=101)))
    # ... autogenerated create_table/create_index calls stay as generated ...


def downgrade() -> None:
    # ... autogenerated drops ...
    op.execute(sa.schema.DropSequence(sa.Sequence("audit_id_seq")))
```

- [ ] **Step 7: Create `migrate.py`**

```python
# apps/api/src/secureflow_api/db/migrate.py
"""Programmatic `alembic upgrade head`. Sync on purpose — env.py owns its own
event loop, so callers inside a running loop must use asyncio.to_thread.
"""

from pathlib import Path

from alembic import command
from alembic.config import Config

ALEMBIC_INI = Path(__file__).resolve().parents[3] / "alembic.ini"


def upgrade_to_head() -> None:
    command.upgrade(Config(str(ALEMBIC_INI)), "head")
```

- [ ] **Step 8: Run test to verify it passes**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_migrations.py -v`
Expected: PASS. Then run it a second time — still PASS (upgrade is idempotent at head).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/secureflow_api/db apps/api/alembic.ini apps/api/alembic apps/api/tests/test_migrations.py
git commit -m "feat(api): schema tables, async engine, alembic initial migration"
```

---

### Task 3: Repositories

**Files:**
- Create: `apps/api/src/secureflow_api/db/repositories.py`
- Modify: `apps/api/tests/conftest.py` (add DB fixtures alongside the existing `fresh_state` — do not remove it yet; Tasks 5–7 still run the old tests)
- Test: `apps/api/tests/test_repositories.py`

**Interfaces:**
- Consumes: `tables.ENTITY_TABLES`, `engine` module, Pydantic models from `models.py`.
- Produces (all in `repositories.py`):
  - `class Repo[M]` with:
    - `table: Table`, `model: type[M]`, `derive: Callable[[M], dict[str, object]]`
    - `async list(self, session: AsyncSession, **filters) -> list[M]` — `filters` are typed-column-name=value pairs; `None` values ignored; ordered `seq ASC`
    - `async get(self, session: AsyncSession, id: str, *, for_update: bool = False) -> M | None`
    - `async save(self, session: AsyncSession, obj: M) -> None` — upsert on `id`, payload + derived columns in one statement
  - `class AuditRepo(Repo[AuditEvent])` overriding list order to `timestamp DESC, seq DESC`, plus `async record(self, session, *, actor, actor_role, action, target, target_type, outcome, detail) -> AuditEvent`
  - Instances: `applications`, `runs`, `approvals`, `findings`, `deployments`, `plans`, `frameworks`, `audit` (an `AuditRepo`), `integrations`, `diagrams`
  - `ALL: dict[str, Repo]` — all ten, same keys as `ENTITY_TABLES`
  - `parse_ts(iso: str) -> datetime` (tz-aware, accepts `Z` suffix)
- Conftest produces: `db_session` fixture (function-scoped `AsyncSession` inside an outer transaction rolled back at teardown; savepoint mode) and `migrated_db` session-scoped fixture (schema at head).

- [ ] **Step 1: Add DB fixtures to conftest**

Append to `apps/api/tests/conftest.py` (keep the existing `fresh_state` fixture untouched for now):

```python
import asyncio
import os

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@localhost:5432/secureflow_test",
)


@pytest.fixture(scope="session")
def migrated_db():
    """Schema at head on the test database. Sync fixture: alembic env.py runs
    its own event loop, so it must not be called from inside pytest-asyncio's."""
    from secureflow_api.db import migrate

    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    migrate.upgrade_to_head()
    return TEST_DATABASE_URL


@pytest.fixture
async def db_session(migrated_db):
    """A session inside an outer transaction that is rolled back at teardown.
    Application commit() calls become savepoint releases — real commit
    semantics never touch the database."""
    engine = create_async_engine(migrated_db)
    async with engine.connect() as conn:
        outer = await conn.begin()
        maker = async_sessionmaker(
            bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )
        async with maker() as session:
            yield session
        await outer.rollback()
    await engine.dispose()
```

(`import pytest` is already present in the file.)

- [ ] **Step 2: Write the failing tests**

```python
# apps/api/tests/test_repositories.py
from sqlalchemy import select, text

from secureflow_api import data
from secureflow_api.db import repositories, tables


async def test_save_roundtrips_payload_exactly(db_session):
    run = data.pipeline_runs()[0]
    await repositories.runs.save(db_session, run)
    loaded = await repositories.runs.get(db_session, run.id)
    assert loaded == run


async def test_save_is_an_upsert(db_session):
    run = data.pipeline_runs()[0]
    await repositories.runs.save(db_session, run)
    run.status = "cancelled"
    await repositories.runs.save(db_session, run)
    rows = (await db_session.execute(select(tables.runs).where(tables.runs.c.id == run.id))).all()
    assert len(rows) == 1
    assert (await repositories.runs.get(db_session, run.id)).status == "cancelled"


async def test_list_filters_on_typed_columns(db_session):
    for run in data.pipeline_runs():
        await repositories.runs.save(db_session, run)
    app_id = data.pipeline_runs()[0].application_id
    scoped = await repositories.runs.list(db_session, application_id=app_id)
    assert len(scoped) > 0
    assert all(r.application_id == app_id for r in scoped)
    everything = await repositories.runs.list(db_session, application_id=None, status=None)
    assert len(everything) == len(data.pipeline_runs())


async def test_list_preserves_insertion_order(db_session):
    fixture = data.pipeline_runs()
    for run in fixture:
        await repositories.runs.save(db_session, run)
    listed = await repositories.runs.list(db_session)
    assert [r.id for r in listed] == [r.id for r in fixture]


async def test_typed_columns_match_payload_for_every_repo(db_session):
    """The hybrid design's one real failure mode is payload/column drift.
    Table-driven: every typed column must equal its payload-derived value."""
    loaders = {
        "applications": data.applications, "runs": data.pipeline_runs,
        "approvals": data.approvals, "findings": data.security_findings,
        "deployments": data.deployments, "plans": data.infrastructure_plans,
        "frameworks": data.compliance_frameworks, "audit": data.audit_events,
        "integrations": data.integrations, "diagrams": data.architecture_diagrams,
    }
    for name, repo in repositories.ALL.items():
        for obj in loaders[name]():
            await repo.save(db_session, obj)
        result = await db_session.execute(select(repo.table))
        for row in result.mappings():
            model = repo.model.model_validate(row["payload"])
            for col, expected in repo.derive(model).items():
                assert row[col] == expected, f"{name}.{col} drifted from payload"


async def test_record_audit_uses_the_sequence(db_session):
    # Sequences are non-transactional: pin it, don't assume test order.
    await db_session.execute(text("SELECT setval('audit_id_seq', 100)"))
    event = await repositories.audit.record(
        db_session,
        actor="You", actor_role="devsecops-engineer", action="test.action",
        target="unit-test", target_type="Test", outcome="success", detail="first",
    )
    assert event.id == "aud-101"
    second = await repositories.audit.record(
        db_session,
        actor="You", actor_role="devsecops-engineer", action="test.action",
        target="unit-test", target_type="Test", outcome="success", detail="second",
    )
    assert second.id == "aud-102"
    listed = await repositories.audit.list(db_session)
    assert listed[0].id == "aud-102"  # newest first
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_repositories.py -v`
Expected: FAIL with `ImportError` (no `repositories` module).

- [ ] **Step 4: Implement `repositories.py`**

```python
# apps/api/src/secureflow_api/db/repositories.py
"""One repository per entity. Reads deserialize payload back into the Pydantic
model — typed columns are for WHERE/ORDER BY, never for reconstructing the
object. save() writes payload and re-derives every typed column in the same
statement, so drift is structurally impossible.
"""

from collections.abc import Callable
from datetime import datetime

from sqlalchemy import Table, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..clock import now_iso
from ..models import (
    ApiModel,
    Application,
    Approval,
    ArchitectureDiagram,
    AuditEvent,
    ComplianceFramework,
    Deployment,
    InfrastructurePlan,
    Integration,
    PipelineRun,
    Role,
    SecurityFinding,
)
from . import tables


def parse_ts(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


class Repo[M: ApiModel]:
    def __init__(
        self,
        table: Table,
        model: type[M],
        derive: Callable[[M], dict[str, object]] = lambda m: {},
    ) -> None:
        self.table = table
        self.model = model
        self.derive = derive

    def _order(self):
        return (self.table.c.seq.asc(),)

    async def list(self, session: AsyncSession, **filters: object) -> list[M]:
        stmt = select(self.table.c.payload).order_by(*self._order())
        for col, val in filters.items():
            if val is not None:
                stmt = stmt.where(self.table.c[col] == val)
        rows = await session.execute(stmt)
        return [self.model.model_validate(payload) for (payload,) in rows]

    async def get(self, session: AsyncSession, id: str, *, for_update: bool = False) -> M | None:
        stmt = select(self.table.c.payload).where(self.table.c.id == id)
        if for_update:
            stmt = stmt.with_for_update()
        payload = (await session.execute(stmt)).scalar_one_or_none()
        return None if payload is None else self.model.model_validate(payload)

    async def save(self, session: AsyncSession, obj: M) -> None:
        payload = obj.model_dump(mode="json", by_alias=True)
        values: dict[str, object] = {"id": obj.id, "payload": payload, **self.derive(obj)}
        stmt = insert(self.table).values(**values)
        stmt = stmt.on_conflict_do_update(
            index_elements=["id"],
            set_={k: v for k, v in values.items() if k != "id"},
        )
        await session.execute(stmt)


class AuditRepo(Repo[AuditEvent]):
    def _order(self):
        return (self.table.c["timestamp"].desc(), self.table.c.seq.desc())

    async def record(
        self,
        session: AsyncSession,
        *,
        actor: str,
        actor_role: Role,
        action: str,
        target: str,
        target_type: str,
        outcome: str,
        detail: str,
    ) -> AuditEvent:
        n = (await session.execute(text("SELECT nextval('audit_id_seq')"))).scalar_one()
        event = AuditEvent(
            id=f"aud-{n}",
            timestamp=now_iso(),
            actor=actor,
            actor_role=actor_role,
            action=action,
            target=target,
            target_type=target_type,
            outcome=outcome,
            detail=detail,
        )
        await self.save(session, event)
        return event


applications = Repo(tables.applications, Application)
runs = Repo(
    tables.runs,
    PipelineRun,
    lambda r: {
        "application_id": r.application_id,
        "status": r.status,
        "environment": r.environment,
        "started_at": parse_ts(r.started_at),
    },
)
approvals = Repo(
    tables.approvals, Approval, lambda a: {"run_id": a.run_id, "decision": a.decision}
)
findings = Repo(
    tables.findings,
    SecurityFinding,
    lambda f: {"application_id": f.application_id, "severity": f.severity, "status": f.status},
)
deployments = Repo(
    tables.deployments,
    Deployment,
    lambda d: {
        "application_id": d.application_id,
        "environment": d.environment,
        "status": d.status,
    },
)
plans = Repo(tables.plans, InfrastructurePlan, lambda p: {"application_id": p.application_id})
frameworks = Repo(tables.frameworks, ComplianceFramework)
audit = AuditRepo(
    tables.audit,
    AuditEvent,
    lambda e: {"timestamp": parse_ts(e.timestamp), "actor": e.actor, "target_type": e.target_type},
)
integrations = Repo(tables.integrations, Integration)
diagrams = Repo(
    tables.diagrams, ArchitectureDiagram, lambda d: {"application_id": d.application_id}
)

ALL: dict[str, Repo] = {
    "applications": applications,
    "runs": runs,
    "approvals": approvals,
    "findings": findings,
    "deployments": deployments,
    "plans": plans,
    "frameworks": frameworks,
    "audit": audit,
    "integrations": integrations,
    "diagrams": diagrams,
}
```

Note: `ApiModel` must be importable from `models.py` — it already is (top-level class).

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_repositories.py -v`
Expected: PASS (7 tests). Also run the whole suite — the old state tests must still pass: `uv run --package secureflow-api pytest apps/api/tests -v`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/secureflow_api/db/repositories.py apps/api/tests/test_repositories.py apps/api/tests/conftest.py
git commit -m "feat(api): entity repositories over hybrid payload/typed-column schema"
```

---

### Task 4: Seed and reset primitives

**Files:**
- Create: `apps/api/src/secureflow_api/db/seed.py`
- Modify: `apps/api/tests/conftest.py` (seed the test DB once, add `committed_session` fixture)
- Test: `apps/api/tests/test_seed.py`

**Interfaces:**
- Consumes: `repositories.ALL`, `data.py` loaders, `tables`.
- Produces:
  - `seed.ensure_seeded(session: AsyncSession) -> bool` — True if it seeded, False if the guard row existed. Serialized by `pg_advisory_xact_lock(SEED_LOCK_KEY)`.
  - `seed.reset_demo(session: AsyncSession) -> None` — truncate all entity tables + `demo_seed`, `setval('audit_id_seq', 100)`, re-insert fixtures, re-insert guard row. Caller commits.
  - `seed.SEED_LOCK_KEY = 715001`
  - Conftest: session-scoped autouse `seeded_db` fixture (test DB migrated + seeded via real commit, reset to pristine via `reset_demo` at session start so reruns are deterministic); `committed_session` function-scoped fixture (real commits, calls `reset_demo` at teardown — for the few tests that need commit semantics).

- [ ] **Step 1: Write the failing tests**

```python
# apps/api/tests/test_seed.py
from sqlalchemy import func, select, text

from secureflow_api import data
from secureflow_api.db import repositories, seed, tables


async def test_seed_inserts_every_collection(committed_session):
    # committed_session starts from a reset database (see fixture teardown
    # ordering); reset_demo has already run, so the guard row exists.
    counts = {
        "applications": len(data.applications()),
        "runs": len(data.pipeline_runs()),
        "approvals": len(data.approvals()),
        "findings": len(data.security_findings()),
        "deployments": len(data.deployments()),
        "plans": len(data.infrastructure_plans()),
        "frameworks": len(data.compliance_frameworks()),
        "audit": len(data.audit_events()),
        "integrations": len(data.integrations()),
        "diagrams": len(data.architecture_diagrams()),
    }
    for name, table in tables.ENTITY_TABLES.items():
        n = (await committed_session.execute(select(func.count()).select_from(table))).scalar_one()
        assert n == counts[name], name


async def test_ensure_seeded_is_idempotent(committed_session):
    assert await seed.ensure_seeded(committed_session) is False  # guard row exists
    n_before = (
        await committed_session.execute(select(func.count()).select_from(tables.runs))
    ).scalar_one()
    assert await seed.ensure_seeded(committed_session) is False
    n_after = (
        await committed_session.execute(select(func.count()).select_from(tables.runs))
    ).scalar_one()
    assert n_before == n_after


async def test_empty_tables_do_not_trigger_reseed(committed_session):
    """Guard is the demo_seed row, not a row count: a demo where the user
    deleted every run must stay deleted across restarts."""
    await committed_session.execute(text("DELETE FROM runs"))
    await committed_session.commit()
    assert await seed.ensure_seeded(committed_session) is False
    n = (await committed_session.execute(select(func.count()).select_from(tables.runs))).scalar_one()
    assert n == 0


async def test_reset_restores_seed_and_audit_sequence(committed_session):
    await committed_session.execute(text("DELETE FROM runs"))
    await committed_session.commit()
    await seed.reset_demo(committed_session)
    await committed_session.commit()
    n = (await committed_session.execute(select(func.count()).select_from(tables.runs))).scalar_one()
    assert n == len(data.pipeline_runs())
    event = await repositories.audit.record(
        committed_session,
        actor="You", actor_role="devsecops-engineer", action="test.action",
        target="t", target_type="Test", outcome="success", detail="post-reset",
    )
    assert event.id == "aud-101"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_seed.py -v`
Expected: FAIL with `ImportError` (no `seed` module / no `committed_session` fixture).

- [ ] **Step 3: Implement `seed.py`**

```python
# apps/api/src/secureflow_api/db/seed.py
"""Demo-stateful seeding. The database auto-seeds from the JSON fixtures when
empty (guarded by the demo_seed row, not a row count) and reset_demo restores
the pristine demo. data.py is the seed source and nothing else — no runtime
code path reads the fixtures directly.
"""

from sqlalchemy import func, insert, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import data
from . import repositories, tables

SEED_LOCK_KEY = 715001

_FIXTURES = [
    (repositories.applications, data.applications),
    (repositories.runs, data.pipeline_runs),
    (repositories.approvals, data.approvals),
    (repositories.findings, data.security_findings),
    (repositories.deployments, data.deployments),
    (repositories.plans, data.infrastructure_plans),
    (repositories.frameworks, data.compliance_frameworks),
    (repositories.audit, data.audit_events),
    (repositories.integrations, data.integrations),
    (repositories.diagrams, data.architecture_diagrams),
]


async def _insert_fixtures(session: AsyncSession) -> None:
    for repo, loader in _FIXTURES:
        for obj in loader():
            await repo.save(session, obj)
    await session.execute(insert(tables.demo_seed).values(seeded_at=func.now()))


async def ensure_seeded(session: AsyncSession) -> bool:
    # Replicas booting together serialize here instead of double-seeding.
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": SEED_LOCK_KEY})
    guard = (await session.execute(select(tables.demo_seed.c.seeded_at))).first()
    if guard is not None:
        return False
    await _insert_fixtures(session)
    return True


async def reset_demo(session: AsyncSession) -> None:
    names = ", ".join(t.name for t in tables.ENTITY_TABLES.values())
    await session.execute(text(f"TRUNCATE {names}, demo_seed RESTART IDENTITY CASCADE"))
    # setval(seq, 100) => the next nextval() returns 101, matching a fresh seed.
    await session.execute(text("SELECT setval('audit_id_seq', 100)"))
    await _insert_fixtures(session)
```

- [ ] **Step 4: Add conftest fixtures**

Append to `apps/api/tests/conftest.py`:

```python
@pytest.fixture(scope="session")
def seeded_db(migrated_db):
    """Pristine seeded test database, committed for real, once per session.
    reset_demo (not ensure_seeded) so a dirty database from an aborted
    earlier run cannot leak state into this one."""
    import asyncio

    from secureflow_api.db import seed

    async def _reset() -> None:
        engine = create_async_engine(migrated_db)
        try:
            async with async_sessionmaker(engine)() as session:
                await seed.reset_demo(session)
                await session.commit()
        finally:
            await engine.dispose()

    asyncio.run(_reset())
    return migrated_db


@pytest.fixture
async def committed_session(seeded_db):
    """Real commit semantics, for tests exercising the seed guard and reset.
    Teardown restores the pristine seed so rollback-based tests stay valid."""
    from secureflow_api.db import seed

    engine = create_async_engine(seeded_db)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            yield session
            await session.rollback()
        async with async_sessionmaker(engine)() as session:
            await seed.reset_demo(session)
            await session.commit()
    finally:
        await engine.dispose()
```

Then change `db_session` (from Task 3) to depend on `seeded_db` instead of `migrated_db`, so rollback-per-test sessions see seeded data:

```python
@pytest.fixture
async def db_session(seeded_db):
    engine = create_async_engine(seeded_db)
    ...  # body unchanged from Task 3
```

And simplify `test_repositories.py`: `test_typed_columns_match_payload_for_every_repo` no longer needs to insert fixtures first (the DB is seeded) — delete its save-loop; the seeded rows are the test data. `test_list_filters_on_typed_columns` and `test_list_preserves_insertion_order` likewise drop their save-loops (saves are upserts, so they would pass either way — dropping them just removes noise).

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_seed.py apps/api/tests/test_repositories.py -v`
Expected: PASS. Run twice back-to-back — second run must also pass (session-start reset makes reruns deterministic).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/secureflow_api/db/seed.py apps/api/tests/test_seed.py apps/api/tests/conftest.py apps/api/tests/test_repositories.py
git commit -m "feat(api): fixture seeding with demo_seed guard and reset primitive"
```

---

### Task 5: Session dependency, lifespan, read routes

**Files:**
- Create: `apps/api/src/secureflow_api/db/session.py`
- Modify: `apps/api/src/secureflow_api/main.py` (lifespan + all GET routes)
- Modify: `apps/api/tests/conftest.py` (add `client` fixture)
- Modify: `apps/api/tests/test_api.py` (async client)

**Interfaces:**
- Consumes: `engine.get_sessionmaker`, `migrate.upgrade_to_head`, `seed.ensure_seeded`, repositories.
- Produces: `session.get_session() -> AsyncIterator[AsyncSession]` FastAPI dependency (commits on success — THE override point for tests); conftest `client` fixture yielding `httpx.AsyncClient` wired to the app with `get_session` overridden to the test's `db_session`.

- [ ] **Step 1: Create `session.py`**

```python
# apps/api/src/secureflow_api/db/session.py
"""Request-scoped session dependency. Tests override exactly this function."""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from .engine import get_sessionmaker


async def get_session() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as session:
        yield session
        await session.commit()
```

- [ ] **Step 2: Add the `client` fixture to conftest**

```python
@pytest.fixture
async def client(db_session):
    from httpx import ASGITransport, AsyncClient

    from secureflow_api.db.session import get_session
    from secureflow_api.main import app

    async def _override():
        yield db_session

    app.dependency_overrides[get_session] = _override
    transport = ASGITransport(app=app)  # no lifespan: migrations/seed/simulator stay out of tests
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
```

- [ ] **Step 3: Rewrite `test_api.py` against the async client**

Mechanical transformation of every test in the file: drop the module-level `TestClient`, each test takes `client`, becomes `async def`, and every `client.get(...)` gains `await`. Two examples of the pattern — apply it to all tests in the file:

```python
# apps/api/tests/test_api.py  (pattern)
async def test_health(client):
    res = await client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "mode": "mock"}


async def test_applications_list_and_contract(client):
    res = await client.get("/api/applications")
    assert res.status_code == 200
    apps = res.json()
    assert len(apps) > 0
    first = apps[0]
    assert "ownerUserId" in first
    assert "openVulnerabilities" in first
    assert "owner_user_id" not in first
```

Every existing assertion stays byte-for-byte — the JSON contract must not move. The SSE test (if it uses `/api/events`) keeps working through ASGITransport streaming; if it hangs, bound it with `client.stream("GET", "/api/events")` reading only the first `hello` event.

- [ ] **Step 4: Run to verify the right failure**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_api.py -v`
Expected: FAIL — routes still read `state.get_state()`, which is seeded fixture data, so most may incidentally pass; the point of this run is that nothing errors on fixture wiring. Proceed regardless.

- [ ] **Step 5: Rewire lifespan and GET routes in `main.py`**

Lifespan:

```python
from .db import migrate, repositories, seed
from .db.engine import dispose_engine, get_sessionmaker
from .db.session import get_session
from .clock import now_iso


@asynccontextmanager
async def lifespan(app: FastAPI):
    await asyncio.to_thread(migrate.upgrade_to_head)
    async with get_sessionmaker()() as session:
        if await seed.ensure_seeded(session):
            logger.info("database seeded from fixtures")
        await session.commit()
    task = None
    if os.environ.get("SIM_ENABLED", "1") != "0":
        task = asyncio.create_task(run_simulator())
    yield
    if task:
        task.cancel()
    await dispose_engine()
```

Every GET route gets `session: AsyncSession = Depends(get_session)` and swaps its `state.get_state()` scan for a repository call. The patterns (apply the matching one to each route):

```python
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession


@app.get("/api/applications")
async def list_applications(session: AsyncSession = Depends(get_session)) -> list[Application]:
    return await repositories.applications.list(session)


@app.get("/api/applications/{app_id}")
async def get_application(app_id: str, session: AsyncSession = Depends(get_session)) -> Application:
    found = await repositories.applications.get(session, app_id)
    if not found:
        raise HTTPException(status_code=404, detail="application_not_found")
    return found


@app.get("/api/runs")
async def list_runs(
    application_id: str | None = Query(default=None, alias="applicationId"),
    status: PipelineRunStatus | None = None,
    environment: EnvironmentName | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[PipelineRun]:
    return await repositories.runs.list(
        session, application_id=application_id, status=status, environment=environment
    )


@app.get("/api/runs/{run_id}/stages/{stage_id}/logs")
async def get_stage_logs(
    run_id: str, stage_id: str, session: AsyncSession = Depends(get_session)
) -> list[PipelineLogLine]:
    run = await repositories.runs.get(session, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run_not_found")
    stage = next(
        (s for s in run.stages if s.id == stage_id or s.definition_id == stage_id), None
    )
    if not stage:
        return []
    return stage_logs(run, stage.definition_id)


@app.get("/api/architecture/{app_id}")
async def get_architecture(app_id: str, session: AsyncSession = Depends(get_session)) -> ArchitectureDiagram:
    found = await repositories.diagrams.list(session, application_id=app_id)
    if not found:
        raise HTTPException(status_code=404, detail="diagram_not_found")
    return found[0]


@app.get("/api/runs/{run_id}/approvals")
async def list_approvals(run_id: str, session: AsyncSession = Depends(get_session)) -> list[Approval]:
    if not await repositories.runs.get(session, run_id):
        raise HTTPException(status_code=404, detail="run_not_found")
    return await repositories.approvals.list(session, run_id=run_id)
```

Simple list routes (`/api/findings`, `/api/deployments`, `/api/plans`, `/api/frameworks`, `/api/audit`, `/api/integrations`) follow `list_applications`. Simple get-by-id routes (`/api/findings/{id}` → `finding_not_found`, `/api/plans/{id}` → `plan_not_found`, `/api/frameworks/{id}` → `framework_not_found`) follow `get_application` with their existing detail strings. `/api/events` and `/health` are untouched. Do NOT touch the POST/PATCH routes yet — they still compile against `state` and Task 6 owns them. Keep `from . import state` until Task 6.

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_api.py -v`
Expected: PASS. Then the full suite: `uv run --package secureflow-api pytest apps/api/tests -v` — `test_mutations.py` (still on the old sync TestClient + state) must still pass, because the mutation routes are unchanged and module import still works.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/secureflow_api/db/session.py apps/api/src/secureflow_api/main.py apps/api/tests/conftest.py apps/api/tests/test_api.py
git commit -m "feat(api): serve reads from postgres through the session dependency"
```

---

### Task 6: Mutation routes

**Files:**
- Modify: `apps/api/src/secureflow_api/main.py` (all POST/PATCH routes)
- Modify: `apps/api/tests/test_mutations.py` (async client)
- Delete: `apps/api/tests/test_state.py`

**Interfaces:**
- Consumes: repositories, `get_session`, `clock.now_iso`, `repositories.audit.record`.
- Produces: all mutating routes persist through repositories. After this task `main.py` no longer imports `state`.

- [ ] **Step 1: Rewrite `test_mutations.py` to the async client**

Same mechanical transformation as `test_api.py`: each test takes `client`, `async def`, `await` on every call. Assertions stay identical. The helper becomes:

```python
async def _first_run_id(client) -> str:
    return (await client.get("/api/runs")).json()[0]["id"]
```

One semantic addition — the audit-id contract test that replaces `test_state.py`'s coverage:

```python
async def test_post_audit_returns_sequenced_event(client, db_session):
    from sqlalchemy import text

    await db_session.execute(text("SELECT setval('audit_id_seq', 100)"))
    res = await client.post("/api/audit", json={
        "actor": "You", "actorRole": "devsecops-engineer", "action": "test.action",
        "target": "unit-test", "targetType": "Test", "outcome": "success",
        "detail": "contract check",
    })
    assert res.status_code == 201
    assert res.json()["id"] == "aud-101"
    newest = (await client.get("/api/audit")).json()[0]
    assert newest["id"] == "aud-101"
```

Delete `apps/api/tests/test_state.py` (`git rm`). Its two behaviors are covered: seed isolation by `test_seed.py`, sequential audit ids by `test_repositories.py` and the contract test above.

- [ ] **Step 2: Run to verify failures**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_mutations.py -v`
Expected: FAIL — mutations still write to `state`, reads now come from Postgres, so every mutate-then-read assertion breaks. This failure IS the migration signal.

- [ ] **Step 3: Rewire the mutation routes**

Every route follows: fetch via repo (with `for_update=True` when mutating), mutate the Pydantic model exactly as before, `save`, audit via `repositories.audit.record`. Full replacements:

```python
@app.post("/api/runs/{run_id}/stages/{stage_id}/retry", status_code=204)
async def retry_stage(
    run_id: str, stage_id: str, session: AsyncSession = Depends(get_session)
) -> None:
    run = await repositories.runs.get(session, run_id, for_update=True)
    stage = (
        next((s for s in run.stages if s.id == stage_id or s.definition_id == stage_id), None)
        if run
        else None
    )
    if not run or not stage:
        raise HTTPException(status_code=404, detail="stage_not_found")
    stage.status = "running"
    stage.failure_reason = None
    stage.started_at = now_iso()
    stage.finished_at = None
    run.status = "running"
    await repositories.runs.save(session, run)
    await repositories.audit.record(
        session,
        actor="You",
        actor_role="devsecops-engineer",
        action="stage.retried",
        target=f"{run_id} / {stage.definition_id}",
        target_type="PipelineStage",
        outcome="success",
        detail=f"Manual retry of '{stage.name}'.",
    )


@app.post("/api/runs/{run_id}/approval", status_code=204)
async def approve_deployment(
    run_id: str, body: ApprovalBody, session: AsyncSession = Depends(get_session)
) -> None:
    run = await repositories.runs.get(session, run_id, for_update=True)
    if not run:
        raise HTTPException(status_code=404, detail="run_not_found")
    run.approval_status = body.decision
    pending = next(
        (
            a
            for a in await repositories.approvals.list(session, run_id=run_id)
            if a.decision == "pending"
        ),
        None,
    )
    if pending:
        pending.decision = body.decision
        pending.decided_by = "You"
        pending.decided_at = now_iso()
        pending.comment = body.comment
        await repositories.approvals.save(session, pending)
    if body.decision == "approved":
        run.status = "running"
        stage = next((s for s in run.stages if s.status == "waiting-approval"), None)
        if stage:
            stage.status = "succeeded"
            stage.finished_at = now_iso()
    else:
        run.status = "cancelled" if body.decision == "rejected" else "blocked"
    await repositories.runs.save(session, run)


@app.patch("/api/findings/{finding_id}/status", status_code=204)
async def update_finding_status(
    finding_id: str, body: FindingStatusBody, session: AsyncSession = Depends(get_session)
) -> None:
    finding = await repositories.findings.get(session, finding_id, for_update=True)
    if not finding:
        raise HTTPException(status_code=404, detail="finding_not_found")
    finding.status = body.status
    if body.reason:
        finding.suppression_history.append(
            SuppressionEntry(date=now_iso(), by="You", reason=body.reason)
        )
    await repositories.findings.save(session, finding)
    await repositories.audit.record(
        session,
        actor="You",
        actor_role="security-engineer",
        action="finding.status-changed",
        target=f"{finding_id} → {body.status}",
        target_type="SecurityFinding",
        outcome="success",
        detail=body.reason or "Status updated from the security command center.",
    )


@app.post("/api/applications/{app_id}/sync", status_code=204)
async def sync_application(app_id: str, session: AsyncSession = Depends(get_session)) -> None:
    if not await repositories.applications.get(session, app_id):
        raise HTTPException(status_code=404, detail="application_not_found")
    for d in await repositories.deployments.list(session, application_id=app_id):
        d.argo_sync_status = "synced"
        await repositories.deployments.save(session, d)


@app.post("/api/applications/{app_id}/promote", status_code=204)
async def promote(
    app_id: str, body: PromoteBody, session: AsyncSession = Depends(get_session)
) -> None:
    if not await repositories.applications.get(session, app_id):
        raise HTTPException(status_code=404, detail="application_not_found")
    from_index = ENV_ORDER.index(body.to_environment) - 1
    from_env = ENV_ORDER[from_index] if from_index >= 0 else None
    deployments = await repositories.deployments.list(session, application_id=app_id)
    source = next((d for d in deployments if d.environment == from_env), None)
    target = next((d for d in deployments if d.environment == body.to_environment), None)
    if source and target:
        target.previous_version = target.version
        target.version = source.version
        target.status = "progressing"
        target.argo_sync_status = "syncing"
        target.deployed_at = now_iso()
        target.deployed_by = "You (promotion)"
        await repositories.deployments.save(session, target)
    await repositories.audit.record(
        session,
        actor="You",
        actor_role="release-approver",
        action="deployment.promoted",
        target=f"{app_id} → {body.to_environment}",
        target_type="Deployment",
        outcome="success",
        detail=f"Promoted {source.version if source else 'latest'} to {body.to_environment}.",
    )


@app.post("/api/applications/{app_id}/rollback", status_code=204)
async def rollback(
    app_id: str, body: RollbackBody, session: AsyncSession = Depends(get_session)
) -> None:
    if not await repositories.applications.get(session, app_id):
        raise HTTPException(status_code=404, detail="application_not_found")
    prod = next(
        (
            d
            for d in await repositories.deployments.list(session, application_id=app_id)
            if d.environment == "production"
        ),
        None,
    )
    if prod:
        prod.previous_version = prod.version
        prod.version = body.revision
        prod.status = "rolled-back"
        prod.deployed_at = now_iso()
        prod.deployed_by = "You (manual rollback)"
        await repositories.deployments.save(session, prod)
    await repositories.audit.record(
        session,
        actor="You",
        actor_role="release-approver",
        action="deployment.rolled-back",
        target=f"{app_id} production → {body.revision}",
        target_type="Deployment",
        outcome="success",
        detail=f"Manual rollback to {body.revision}.",
    )


@app.post("/api/audit", status_code=201)
async def record_audit_event(
    body: AuditRecordBody, session: AsyncSession = Depends(get_session)
) -> AuditEvent:
    return await repositories.audit.record(
        session,
        actor=body.actor,
        actor_role=body.actor_role,
        action=body.action,
        target=body.target,
        target_type=body.target_type,
        outcome=body.outcome,
        detail=body.detail,
    )
```

Remove `from . import state` and the `state.` references from `main.py` entirely (`now_iso` comes from `clock`, imported in Task 5).

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_mutations.py apps/api/tests/test_api.py -v`
Expected: PASS.

- [ ] **Step 5: Full suite check**

Run: `uv run --package secureflow-api pytest apps/api/tests -v`
Expected: everything passes except possibly `test_simulator.py` (still on `state` — Task 7 owns it; it should still pass here since `state.py` still exists).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/secureflow_api/main.py apps/api/tests/test_mutations.py
git rm apps/api/tests/test_state.py
git commit -m "feat(api): persist mutations through repositories, retire state tests"
```

---

### Task 7: Simulator against the database

**Files:**
- Modify: `apps/api/src/secureflow_api/simulator.py` (full rewrite of state access; tick logic itself unchanged)
- Modify: `apps/api/tests/test_simulator.py`
- Modify: `apps/api/tests/conftest.py` (drop `simulator.reset()` calls from `fresh_state` — see step 4)

**Interfaces:**
- Consumes: `repositories.runs` / `repositories.deployments`, `engine.get_engine`, `engine.get_sessionmaker`, `clock.now_iso`, `events.broadcast`.
- Produces:
  - `async simulator.tick(session: AsyncSession) -> None` — one tick, caller commits.
  - `async simulator.run_simulator() -> None` — loop; acquires `pg_try_advisory_lock(TICKER_LOCK_KEY)` on a dedicated connection, exits quietly if another replica holds it.
  - `simulator.TICKER_LOCK_KEY = 715003`, `SIMULATED_RUN_ID`, `RESET_INDEX`, `STOP_AFTER` unchanged. `IDLE_SECONDS` from env `SIM_IDLE_SECONDS` (default `35.0`). Module global `_idle_ticks` and `reset()` are deleted.

- [ ] **Step 1: Rewrite `test_simulator.py`**

```python
# apps/api/tests/test_simulator.py
from datetime import datetime, timedelta, timezone

from secureflow_api.db import repositories
from secureflow_api.simulator import SIMULATED_RUN_ID, tick


async def _run(session):
    return await repositories.runs.get(session, SIMULATED_RUN_ID)


async def test_tick_advances_the_running_stage(db_session):
    run = await _run(db_session)
    assert run.status == "running", "fixture assumption: run-0512 ships mid-flight"
    running_idx = next(i for i, s in enumerate(run.stages) if s.status == "running")
    await tick(db_session)
    run = await _run(db_session)  # re-read: tick writes through its own save
    assert run.stages[running_idx].status == "succeeded"
    assert run.stages[running_idx].finished_at is not None


async def test_run_completes_then_restarts_after_idle(db_session):
    for _ in range(60):
        await tick(db_session)
        run = await _run(db_session)
        if run.status == "succeeded":
            break
    assert run.status == "succeeded"
    assert run.security_gate == "passed"
    assert all(s.status != "pending" for s in run.stages)

    # Idle window not yet elapsed: tick must not restart the run.
    await tick(db_session)
    assert (await _run(db_session)).status == "succeeded"

    # Age finished_at past IDLE_SECONDS; the next tick restarts.
    aged = (datetime.now(timezone.utc) - timedelta(seconds=3600)).isoformat(
        timespec="milliseconds"
    ).replace("+00:00", "Z")
    run.finished_at = aged
    await repositories.runs.save(db_session, run)
    await tick(db_session)
    assert (await _run(db_session)).status == "running"


async def test_image_scan_injects_finding(db_session):
    for _ in range(60):
        await tick(db_session)
        run = await _run(db_session)
        image_scan = next(s for s in run.stages if s.definition_id == "image-scan")
        if image_scan.status == "succeeded":
            break
    assert len(image_scan.findings) == 1
    assert image_scan.findings[0].finding_id == "find-missing-limits"
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_simulator.py -v`
Expected: FAIL — `tick` is sync and takes `AppState`.

- [ ] **Step 3: Rewrite `simulator.py`**

Keep the docstring, constants, `_seconds_between`, `_notify`, `_run_updated` as they are (swap `from .state import ...` for `from .clock import now_iso`). Replace the state plumbing:

```python
import asyncio
import logging
import os
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .clock import now_iso
from .db import repositories
from .db.engine import get_engine, get_sessionmaker
from .events import broadcast
from .models import StageFindingRef

SIMULATED_RUN_ID = "run-0512"
RESET_INDEX = 11
STOP_AFTER = "smoke-tests"
TICKER_LOCK_KEY = 715003

IDLE_SECONDS = float(os.environ.get("SIM_IDLE_SECONDS", "35"))


def _idle_elapsed(finished_at: str | None) -> bool:
    if not finished_at:
        return True
    t = datetime.fromisoformat(finished_at.replace("Z", "+00:00"))
    return (datetime.now(timezone.utc) - t).total_seconds() > IDLE_SECONDS


async def tick(session: AsyncSession) -> None:
    # FOR UPDATE: the simulated run is the one row both the simulator and the
    # request handlers write; the lock serializes the only real race. All
    # other writes in the app are last-write-wins by design.
    run = await repositories.runs.get(session, SIMULATED_RUN_ID, for_update=True)
    if not run:
        return

    if run.status == "succeeded":
        if not _idle_elapsed(run.finished_at):
            return
        run.status = "running"
        run.security_gate = "in-progress"
        run.finished_at = None
        run.duration_seconds = None
        run.started_at = now_iso()
        for stage in run.stages[RESET_INDEX:]:
            stage.status = "pending"
            stage.started_at = None
            stage.finished_at = None
            stage.duration_seconds = None
            stage.findings = []
        first = run.stages[RESET_INDEX]
        first.status = "running"
        first.started_at = now_iso()
        await repositories.runs.save(session, run)
        _notify(
            "Pipeline started",
            f"notification-worker {run.artifact_version} — new execution began.",
            "info",
        )
        _run_updated(run.id)
        return

    if run.status != "running":
        return

    idx = next((i for i, s in enumerate(run.stages) if s.status == "running"), -1)
    if idx == -1:
        return
    current = run.stages[idx]

    # ... the entire existing stage-advance body stays verbatim, with ONE
    # change: the argo-sync branch fetches and saves the deployment via the
    # repository instead of scanning state.deployments:
    #
    #     if current.definition_id == "argo-sync":
    #         dep = await repositories.deployments.get(session, "dep-not-dev")
    #         if dep:
    #             dep.argo_sync_status = "synced"
    #             dep.status = "healthy"
    #             dep.version = run.artifact_version
    #             await repositories.deployments.save(session, dep)
    #
    # and both early-return paths plus the fall-through end with:
    #     await repositories.runs.save(session, run)
    # placed BEFORE the _notify/_run_updated broadcasts.


async def run_simulator() -> None:
    tick_seconds = float(os.environ.get("SIM_TICK_SECONDS", "7"))
    maker = get_sessionmaker()
    # Session-level advisory lock on a dedicated connection, held for the
    # process lifetime: exactly one replica drives the demo.
    async with get_engine().connect() as lock_conn:
        got = (
            await lock_conn.execute(
                text("SELECT pg_try_advisory_lock(:key)"), {"key": TICKER_LOCK_KEY}
            )
        ).scalar()
        if not got:
            logging.getLogger(__name__).info("another replica holds the ticker lock; idle")
            return
        while True:
            await asyncio.sleep(tick_seconds)
            try:
                async with maker() as session:
                    await tick(session)
                    await session.commit()
            except Exception:
                logging.getLogger(__name__).exception("simulator tick failed")
```

The commented block is instruction, not code to paste as comments — port the existing `tick` body (simulator.py lines 82–144 today) with those two mechanical changes. Delete `_idle_ticks`, `IDLE_TICKS`, and `reset()`.

- [ ] **Step 4: Trim the old conftest fixture**

`fresh_state` in conftest still calls `simulator.reset()`, which no longer exists. The fixture's remaining purpose (`state.reset_state()`) dies in Task 8; for now reduce it to:

```python
@pytest.fixture(autouse=True)
def fresh_state():
    state.reset_state()
    yield
    state.reset_state()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_simulator.py -v`
Expected: PASS. Then full suite: `uv run --package secureflow-api pytest apps/api/tests -v` — PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/secureflow_api/simulator.py apps/api/tests/test_simulator.py apps/api/tests/conftest.py
git commit -m "feat(api): simulator ticks against postgres with row lock and derived idle state"
```

---

### Task 8: Reset endpoint, delete state.py

**Files:**
- Modify: `apps/api/src/secureflow_api/main.py` (add `/api/demo/reset`)
- Delete: `apps/api/src/secureflow_api/state.py`
- Modify: `apps/api/tests/conftest.py` (delete `fresh_state`)
- Test: `apps/api/tests/test_demo_reset.py`

**Interfaces:**
- Consumes: `seed.reset_demo`, `broadcast`, `clock.now_iso`.
- Produces: `POST /api/demo/reset` → 204; 404 when `DEMO_RESET_ENABLED=0` (an endpoint production does not advertise); broadcasts SSE event `state-reset` with `{"at": <iso>}` so connected SPAs refetch. `state.py` gone.

- [ ] **Step 1: Write the failing tests**

```python
# apps/api/tests/test_demo_reset.py
from sqlalchemy import text

from secureflow_api.db.session import get_session
from secureflow_api.main import app


async def _client_for(session):
    from httpx import ASGITransport, AsyncClient

    async def _override():
        yield session

    app.dependency_overrides[get_session] = _override
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_reset_restores_seed(committed_session, monkeypatch):
    monkeypatch.setenv("DEMO_RESET_ENABLED", "1")
    await committed_session.execute(text("DELETE FROM runs"))
    await committed_session.commit()
    async with await _client_for(committed_session) as client:
        res = await client.post("/api/demo/reset")
        assert res.status_code == 204
        runs = (await client.get("/api/runs")).json()
        assert len(runs) > 0
        audit = (await client.get("/api/audit")).json()
        assert audit[0]["id"] == "aud-1"  # pristine: newest fixture event, no runtime rows
    app.dependency_overrides.clear()


async def test_reset_is_absent_when_disabled(committed_session, monkeypatch):
    monkeypatch.setenv("DEMO_RESET_ENABLED", "0")
    async with await _client_for(committed_session) as client:
        res = await client.post("/api/demo/reset")
        assert res.status_code == 404
    app.dependency_overrides.clear()
```

(`committed_session`, not `db_session`: `TRUNCATE` acquires ACCESS EXCLUSIVE locks and behaves badly inside the savepoint harness.)

- [ ] **Step 2: Run to verify failure**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_demo_reset.py -v`
Expected: FAIL with 404 on the first test (route does not exist) — note the second test "passes" trivially; the first is the signal.

- [ ] **Step 3: Add the route**

`seed` is already imported in `main.py` since Task 5's lifespan change (`from .db import migrate, repositories, seed`).

```python
@app.post("/api/demo/reset", status_code=204)
async def demo_reset(session: AsyncSession = Depends(get_session)) -> None:
    if os.environ.get("DEMO_RESET_ENABLED", "1") == "0":
        # 404, not 403: production does not advertise an endpoint it refuses.
        raise HTTPException(status_code=404, detail="not_found")
    await seed.reset_demo(session)
    broadcast.publish("state-reset", {"at": now_iso()})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_demo_reset.py -v`
Expected: PASS.

- [ ] **Step 5: Delete `state.py`**

```bash
grep -rn "from . import state\|from .state\|secureflow_api import state\|secureflow_api.state" apps/api
```

Expected: only `tests/conftest.py` (the `fresh_state` fixture and its import). Remove the fixture and the `state`/`simulator` imports from conftest, then:

```bash
git rm apps/api/src/secureflow_api/state.py
```

- [ ] **Step 6: Full suite**

Run: `uv run --package secureflow-api pytest apps/api/tests -v`
Expected: PASS, no `state` imports anywhere.

- [ ] **Step 7: Update `docs/security-model.md`**

Add one line to the API section: `POST /api/demo/reset` restores the demo seed; gated by `DEMO_RESET_ENABLED` and returns 404 when disabled, which is the production default — production does not advertise the endpoint.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/secureflow_api/main.py apps/api/tests/test_demo_reset.py apps/api/tests/conftest.py docs/security-model.md
git commit -m "feat(api): guarded demo reset endpoint; delete in-memory state"
```

---

### Task 9: CI and Playwright wiring

**Files:**
- Modify: `.github/workflows/ci.yml` (`quality` and `e2e-http` jobs)
- Modify: `apps/web/playwright.http.config.ts`

**Interfaces:**
- Consumes: everything shipped in Tasks 1–8.
- Produces: green CI with real-Postgres tests; `pnpm e2e:http` works locally against compose and in CI against the service container.

- [ ] **Step 1: Add the service container to `quality`**

In `.github/workflows/ci.yml`, under the `quality` job (sibling of `steps:`):

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

On the `API tests (pytest)` step add:

```yaml
        env:
          TEST_DATABASE_URL: postgresql+asyncpg://postgres:postgres@localhost:5432/secureflow_test
```

Immediately after it, add the drift gate:

```yaml
      - name: Migration drift check (alembic)
        run: uv run --package secureflow-api alembic -c apps/api/alembic.ini check
        env:
          DATABASE_URL: postgresql+asyncpg://postgres:postgres@localhost:5432/secureflow_test
```

(`alembic check` compares `tables.py` metadata against the migration history on a live connection; the pytest run has already upgraded this database to head.)

- [ ] **Step 2: Add the service container to `e2e-http`**

Same `services:` block but with `POSTGRES_DB: secureflow`. No job-level env needed — the connection string rides in the Playwright config (next step), and its default matches this service.

- [ ] **Step 3: Wire `DATABASE_URL` into the Playwright webServer**

In `apps/web/playwright.http.config.ts`, extend the API `webServer` entry's `env` (comment included — the next reader will wonder):

```typescript
      env: {
        SIM_TICK_SECONDS: "2",
        // The API requires Postgres (docker compose up -d db locally; the
        // e2e-http service container in CI). Same default as engine.py.
        DATABASE_URL:
          process.env.DATABASE_URL ??
          "postgresql+asyncpg://postgres:postgres@localhost:5432/secureflow",
      },
```

- [ ] **Step 4: Verify locally**

```bash
docker compose up -d db
uv run --package secureflow-api pytest apps/api/tests
pnpm e2e:http
```

Expected: both green. The e2e run now exercises migrate → seed → simulate against real Postgres.

- [ ] **Step 5: Commit and verify CI**

```bash
git add .github/workflows/ci.yml apps/web/playwright.http.config.ts
git commit -m "ci: postgres service containers for pytest and e2e, alembic drift gate"
git push
gh run watch
```

Expected: `quality`, `e2e-http`, `build`, `infrastructure` green; deploy jobs `skipped` (that is the intended green state).

---

### Task 10: Terraform version and docs

**Files:**
- Modify: `infrastructure/modules/postgres/main.tf`
- Modify: `docs/local-development.md`, `docs/architecture.md`, `docs/deployment.md`

**Interfaces:**
- Consumes: nothing from earlier tasks (docs describe them).
- Produces: PG 17 everywhere; documentation matching reality.

- [ ] **Step 1: Bump the module to Postgres 17**

In `infrastructure/modules/postgres/main.tf` change `version = "16"` to `version = "17"` (matches `docker-compose.yml` and the CI service containers; nothing is deployed, so this is free).

Run: `terraform fmt -check -recursive infrastructure && terraform -chdir=infrastructure/environments/dev init -backend=false -input=false && terraform -chdir=infrastructure/environments/dev validate`
Expected: clean.

- [ ] **Step 2: Documentation**

- `docs/local-development.md`: new "Database" section — `docker compose up -d db` is the one required dependency; `DATABASE_URL`/`TEST_DATABASE_URL` defaults; migrations and seeding run automatically at API startup; `POST /api/demo/reset` restores the demo; state now survives restarts.
- `docs/architecture.md`: storage story — hybrid JSONB + typed columns, payload as source of truth, Alembic owns schema, demo-stateful semantics (seed guard, not row count), single-ticker advisory lock. Include the known limitation verbatim from the spec: in-process SSE means only clients on the ticking replica see live events; the multi-replica fix is Postgres LISTEN/NOTIFY, not Redis.
- `docs/deployment.md`: `DATABASE_URL` flows Key Vault → Container App secret → env var (password auth now; managed-identity/Entra token is a later change); migrations run at app startup under an advisory lock. Note the tracked follow-up: the postgres module is hard-wired to private networking and does not yet honor the `enable_private_networking` gate.

- [ ] **Step 3: Full local verification**

```bash
uv run --package secureflow-api pytest apps/api/tests
pnpm test
pnpm e2e:http
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add infrastructure/modules/postgres/main.tf docs/local-development.md docs/architecture.md docs/deployment.md
git commit -m "docs+infra: postgres 17 in terraform, storage story documented"
```

---

## Self-review notes (already applied)

- Spec §3.2 says reset re-runs `simulator.reset()`; Task 7 deletes `reset()` because derived idle state leaves nothing to reset — the endpoint (Task 8) therefore doesn't call it. Deliberate.
- Spec §6 puts migrations in the container entrypoint; this plan runs them in lifespan (Global Constraints notes why). `docker/Dockerfile.api` needs no change.
- `test_state.py`'s two behaviors are re-homed (Task 6 step 1) before the file is deleted.
- Sequence non-transactionality is called out in Global Constraints and every id-asserting test pins the sequence itself.
