import pytest

from secureflow_api import state


@pytest.fixture(autouse=True)
def fresh_state():
    state.reset_state()
    yield
    state.reset_state()


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
async def db_session(seeded_db):
    """A session inside an outer transaction that is rolled back at teardown.
    Application commit() calls become savepoint releases — real commit
    semantics never touch the database."""
    engine = create_async_engine(seeded_db)
    async with engine.connect() as conn:
        outer = await conn.begin()
        maker = async_sessionmaker(
            bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )
        async with maker() as session:
            yield session
        await outer.rollback()
    await engine.dispose()


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
