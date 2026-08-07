import pytest
from fastapi.routing import APIRoute

from secureflow_api.auth import dependencies as authdeps
from secureflow_api.main import app

# Routes whose permission depends on the request body; they authenticate via
# get_principal and check permissions in the handler (Task 8).
HANDLER_CHECKED = {"/api/runs/{run_id}/approval", "/api/audit"}


def _api_routes():
    return [
        r for r in app.routes if isinstance(r, APIRoute) and r.path.startswith("/api")
    ]


def _auth_calls(route):
    return [d.call for d in route.dependant.dependencies]


def test_every_api_route_authenticates():
    for route in _api_routes():
        calls = _auth_calls(route)
        assert any(
            c in (authdeps.get_principal, authdeps.get_principal_sse)
            or getattr(c, "required_permission", None)
            for c in calls
        ), f"unauthenticated route: {route.path}"


def test_every_mutating_route_declares_permission():
    for route in _api_routes():
        if not (route.methods & {"POST", "PATCH"}):
            continue
        calls = _auth_calls(route)
        has_permission = any(getattr(c, "required_permission", None) for c in calls)
        assert has_permission or route.path in HANDLER_CHECKED, (
            f"mutating route without permission: {route.path}"
        )


def test_health_stays_open():
    health = next(r for r in app.routes if isinstance(r, APIRoute) and r.path == "/health")
    assert not _auth_calls(health)


async def test_get_requires_token_when_enabled(auth_enabled, client):
    response = await client.get("/api/applications")
    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"


async def test_get_with_token_ok(auth_enabled, make_token, client):
    response = await client.get(
        "/api/applications",
        headers={"Authorization": f"Bearer {make_token(roles=['compliance-reviewer'])}"},
    )
    assert response.status_code == 200


async def test_retry_permission_enforced(auth_enabled, make_token, client):
    runs = (
        await client.get(
            "/api/runs", headers={"Authorization": f"Bearer {make_token()}"}
        )
    ).json()
    run = runs[0]
    stage = run["stages"][0]
    url = f"/api/runs/{run['id']}/stages/{stage['id']}/retry"
    denied = await client.post(
        url, headers={"Authorization": f"Bearer {make_token(roles=['compliance-reviewer'])}"}
    )
    assert denied.status_code == 403
    allowed = await client.post(
        url, headers={"Authorization": f"Bearer {make_token(roles=['developer'])}"}
    )
    assert allowed.status_code == 204


async def test_promote_permission_enforced(auth_enabled, make_token, client):
    apps_ = (
        await client.get(
            "/api/applications", headers={"Authorization": f"Bearer {make_token()}"}
        )
    ).json()
    url = f"/api/applications/{apps_[0]['id']}/promote"
    body = {"toEnvironment": "production"}
    denied = await client.post(
        url, json=body,
        headers={"Authorization": f"Bearer {make_token(roles=['developer'])}"},
    )
    assert denied.status_code == 403
    allowed = await client.post(
        url, json=body,
        headers={"Authorization": f"Bearer {make_token(roles=['release-approver'])}"},
    )
    assert allowed.status_code == 204


async def test_demo_reset_needs_settings_manage(auth_enabled, make_token, client, monkeypatch):
    monkeypatch.setenv("DEMO_RESET_ENABLED", "1")
    denied = await client.post(
        "/api/demo/reset",
        headers={"Authorization": f"Bearer {make_token(roles=['release-approver'])}"},
    )
    assert denied.status_code == 403


# httpx's ASGITransport buffers the whole response body, so a 200 on the
# infinite SSE stream can never be observed here. Query-token acceptance is
# runtime-tested against get_principal_sse directly in test_auth_dependencies;
# this asserts /api/events is wired to that variant (and nothing else is).
def test_events_uses_sse_dependency():
    events = next(r for r in _api_routes() if r.path == "/api/events")
    assert authdeps.get_principal_sse in _auth_calls(events)
    for route in _api_routes():
        if route.path != "/api/events":
            assert authdeps.get_principal_sse not in _auth_calls(route), (
                f"query-token auth leaked onto {route.path}"
            )


async def test_events_rejects_missing_token(auth_enabled, client):
    async with client.stream("GET", "/api/events") as response:
        assert response.status_code == 401


async def test_query_token_rejected_off_sse(auth_enabled, make_token, client):
    response = await client.get(f"/api/applications?access_token={make_token()}")
    assert response.status_code == 401


async def test_disabled_mode_stays_open(client, monkeypatch):
    monkeypatch.delenv("AUTH_ENABLED", raising=False)
    response = await client.get("/api/applications")
    assert response.status_code == 200
