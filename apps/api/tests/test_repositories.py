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
