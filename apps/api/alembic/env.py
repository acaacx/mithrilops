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
    # The advisory-lock execute() above autobegins a transaction that
    # context.begin_transaction() then nests as a savepoint rather than
    # owning outright; closing the connection without this commit rolls
    # the whole thing back (savepoint release does not persist to disk).
    connection.commit()


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
