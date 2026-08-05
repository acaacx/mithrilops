import pytest
from sqlalchemy import text

from secureflow_api.db.session import get_session
from secureflow_api.main import app


@pytest.fixture
async def reset_client(committed_session):
    """Mirrors the `client` fixture in conftest.py, but wired to
    committed_session so tests get real commit semantics. Owns only the
    client/override lifecycle — env vars (DEMO_RESET_ENABLED) are each
    test's own concern. Teardown (after yield) always runs, even on
    assertion failure, so the override never leaks into later tests."""
    from httpx import ASGITransport, AsyncClient

    async def _override():
        yield committed_session

    app.dependency_overrides[get_session] = _override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def test_reset_restores_seed(committed_session, reset_client, monkeypatch):
    monkeypatch.setenv("DEMO_RESET_ENABLED", "1")
    await committed_session.execute(text("DELETE FROM runs"))
    await committed_session.commit()
    res = await reset_client.post("/api/demo/reset")
    assert res.status_code == 204
    runs = (await reset_client.get("/api/runs")).json()
    assert len(runs) > 0
    audit = (await reset_client.get("/api/audit")).json()
    assert audit[0]["id"] == "aud-1"  # pristine: newest fixture event, no runtime rows


async def test_reset_is_absent_when_disabled(reset_client, monkeypatch):
    monkeypatch.setenv("DEMO_RESET_ENABLED", "0")
    res = await reset_client.post("/api/demo/reset")
    assert res.status_code == 404
