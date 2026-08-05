import pytest

from secureflow_api import state, simulator


@pytest.fixture(autouse=True)
def fresh_state():
    state.reset_state()
    simulator.reset()
    yield
    state.reset_state()
    simulator.reset()


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
