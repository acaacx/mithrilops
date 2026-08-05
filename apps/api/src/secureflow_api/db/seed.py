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
