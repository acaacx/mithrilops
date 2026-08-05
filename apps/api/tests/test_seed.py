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
