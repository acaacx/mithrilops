from sqlalchemy import text

from secureflow_api.db.session import get_session
from secureflow_api.main import app


async def _client_for(session):
    from httpx import ASGITransport, AsyncClient

    async def _override():
        yield session

    app.dependency_overrides[get_session] = _override
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_reset_restores_seed(committed_session, monkeypatch):
    monkeypatch.setenv("DEMO_RESET_ENABLED", "1")
    await committed_session.execute(text("DELETE FROM runs"))
    await committed_session.commit()
    async with await _client_for(committed_session) as client:
        res = await client.post("/api/demo/reset")
        assert res.status_code == 204
        runs = (await client.get("/api/runs")).json()
        assert len(runs) > 0
        audit = (await client.get("/api/audit")).json()
        assert audit[0]["id"] == "aud-1"  # pristine: newest fixture event, no runtime rows
    app.dependency_overrides.clear()


async def test_reset_is_absent_when_disabled(committed_session, monkeypatch):
    monkeypatch.setenv("DEMO_RESET_ENABLED", "0")
    async with await _client_for(committed_session) as client:
        res = await client.post("/api/demo/reset")
        assert res.status_code == 404
    app.dependency_overrides.clear()
