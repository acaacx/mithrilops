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
