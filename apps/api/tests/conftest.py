import asyncio
import os

import pytest
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


# --- auth fixtures ------------------------------------------------------

TEST_TENANT = "11111111-1111-1111-1111-111111111111"
TEST_AUDIENCE = "api://secureflow-tests"
TEST_ISSUER = f"https://login.microsoftonline.com/{TEST_TENANT}/v2.0"


@pytest.fixture(scope="session")
def auth_keys():
    """(primary, imposter) RSA keypairs. Imposter signs 'wrong key' tokens."""
    from cryptography.hazmat.primitives.asymmetric import rsa

    generate = lambda: rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return generate(), generate()


@pytest.fixture(scope="session")
def jwks_document(auth_keys):
    from jwt.algorithms import RSAAlgorithm

    jwk = RSAAlgorithm.to_jwk(auth_keys[0].public_key(), as_dict=True)
    jwk.update({"kid": "test-key-1", "use": "sig", "alg": "RS256"})
    return {"keys": [jwk]}


@pytest.fixture
def make_token(auth_keys):
    import time

    import jwt as pyjwt

    def _make(
        roles=("administrator",),
        *,
        key=None,
        kid="test-key-1",
        aud=TEST_AUDIENCE,
        iss=TEST_ISSUER,
        exp_delta=300,
        alg="RS256",
        drop=(),
    ):
        now = int(time.time())
        claims = {
            "sub": "user-123",
            "name": "Test User",
            "roles": list(roles),
            "aud": aud,
            "iss": iss,
            "iat": now,
            "exp": now + exp_delta,
        }
        for claim in drop:
            claims.pop(claim)
        return pyjwt.encode(claims, key or auth_keys[0], algorithm=alg, headers={"kid": kid})

    return _make


@pytest.fixture
def auth_enabled(monkeypatch, jwks_document):
    """Turn enforcement on and serve the fixture JWKS without any network:
    PyJWKClient.fetch_data is patched, so kid lookup and key parsing stay real."""
    from jwt import PyJWKClient

    from secureflow_api.auth import jwks as jwks_module

    monkeypatch.setenv("AUTH_ENABLED", "1")
    monkeypatch.setenv("ENTRA_TENANT_ID", TEST_TENANT)
    monkeypatch.setenv("ENTRA_CLIENT_ID", TEST_AUDIENCE)
    monkeypatch.delenv("ENTRA_JWKS_URL", raising=False)
    monkeypatch.setattr(PyJWKClient, "fetch_data", lambda self: jwks_document)
    jwks_module._client.cache_clear()


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
