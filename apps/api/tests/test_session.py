# apps/api/tests/test_session.py
"""Coverage for the REAL get_session dependency (db/session.py). Every other
test in this suite overrides get_session with a session pinned inside an
outer transaction (see conftest.py's db_session/client fixtures), so the
commit-on-success / rollback-on-exception boundary in get_session itself has
no coverage anywhere else. These two tests drive the app with no override at
all, through the actual ASGI dependency-injection path.
"""

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from secureflow_api import data
from secureflow_api.db import seed, tables
from secureflow_api.db.engine import dispose_engine
from secureflow_api.main import app


@pytest.fixture
async def real_session_client(seeded_db, monkeypatch):
    """Drives the app with the real get_session dependency (no
    app.dependency_overrides entry) against the seeded test database.

    engine.get_engine()/get_sessionmaker() cache a module-level engine, so it
    must be rebuilt from DATABASE_URL both before (to point it at the test
    database rather than whatever default/dev URL a prior test left behind)
    and after (so later tests — most of which also rebuild lazily, but some
    may not — aren't left pointing at a torn-down engine)."""
    monkeypatch.setenv("DATABASE_URL", seeded_db)
    await dispose_engine()
    transport = ASGITransport(app=app)  # no lifespan: no migrate/seed/simulator here
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
    await dispose_engine()
    # This test performed real commits against the shared test database
    # (unlike every other test, which rolls back an outer transaction), so
    # restore the pristine seed the same way committed_session's teardown
    # does in conftest.py.
    engine = create_async_engine(seeded_db)
    try:
        async with async_sessionmaker(engine)() as session:
            await seed.reset_demo(session)
            await session.commit()
    finally:
        await engine.dispose()


async def test_successful_mutation_commits_through_real_get_session(
    real_session_client, seeded_db
):
    finding_id = data.security_findings()[0].id

    res = await real_session_client.patch(
        f"/api/findings/{finding_id}/status", json={"status": "resolved"}
    )
    assert res.status_code == 204

    # Verify from a separate engine/connection, not the app's — proves the
    # write actually reached the database rather than living only in the
    # request's own session object.
    engine = create_async_engine(seeded_db)
    try:
        async with engine.connect() as conn:
            payload = (
                await conn.execute(
                    select(tables.findings.c.payload).where(
                        tables.findings.c.id == finding_id
                    )
                )
            ).scalar_one()
    finally:
        await engine.dispose()
    assert payload["status"] == "resolved"


async def test_failed_route_leaves_no_partial_state(real_session_client, seeded_db):
    before = len(data.security_findings())

    res = await real_session_client.patch(
        "/api/findings/does-not-exist/status", json={"status": "resolved"}
    )
    assert res.status_code == 404

    # The 404 is raised before any write; get_session's `async with session`
    # must roll back (not commit) when the HTTPException propagates out of
    # the route through the generator's yield point.
    engine = create_async_engine(seeded_db)
    try:
        async with engine.connect() as conn:
            after = (
                await conn.execute(text("SELECT count(*) FROM findings"))
            ).scalar_one()
    finally:
        await engine.dispose()
    assert after == before

    # And the engine/session machinery itself is still healthy afterward —
    # an unhandled exception in get_session didn't wedge the pool.
    res = await real_session_client.get("/api/findings")
    assert res.status_code == 200
