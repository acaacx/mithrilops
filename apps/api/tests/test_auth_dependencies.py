import pytest
from fastapi import HTTPException, Request

from secureflow_api.auth.dependencies import (
    get_principal,
    get_principal_sse,
    require_permission,
)


def _request(headers: dict[str, str] | None = None, query: str = "") -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    return Request(
        {"type": "http", "method": "GET", "path": "/api/x", "headers": raw,
         "query_string": query.encode()}
    )


async def test_disabled_mode_returns_demo_principal(monkeypatch):
    monkeypatch.delenv("AUTH_ENABLED", raising=False)
    principal = await get_principal(_request())
    assert principal.name == "You"
    assert "settings.manage" in principal.permissions


async def test_enabled_missing_header_401(auth_enabled):
    with pytest.raises(HTTPException) as exc:
        await get_principal(_request())
    assert exc.value.status_code == 401
    assert exc.value.headers["WWW-Authenticate"] == "Bearer"


async def test_enabled_valid_bearer(auth_enabled, make_token):
    principal = await get_principal(
        _request({"Authorization": f"Bearer {make_token(roles=['developer'])}"})
    )
    assert principal.roles == ("developer",)


async def test_non_bearer_scheme_401(auth_enabled, make_token):
    with pytest.raises(HTTPException) as exc:
        await get_principal(_request({"Authorization": f"Basic {make_token()}"}))
    assert exc.value.status_code == 401


async def test_sse_accepts_query_token(auth_enabled, make_token):
    principal = await get_principal_sse(
        _request(query=f"access_token={make_token(roles=['developer'])}")
    )
    assert principal.roles == ("developer",)


async def test_sse_prefers_header(auth_enabled, make_token):
    principal = await get_principal_sse(
        _request(
            {"Authorization": f"Bearer {make_token(roles=['developer'])}"},
            query=f"access_token={make_token(roles=['administrator'])}",
        )
    )
    assert principal.roles == ("developer",)


async def test_sse_no_token_401(auth_enabled):
    with pytest.raises(HTTPException) as exc:
        await get_principal_sse(_request())
    assert exc.value.status_code == 401


async def test_plain_get_principal_ignores_query_token(auth_enabled, make_token):
    with pytest.raises(HTTPException) as exc:
        await get_principal(_request(query=f"access_token={make_token()}"))
    assert exc.value.status_code == 401


def test_require_permission_exposes_marker():
    dep = require_permission("deployment.approve")
    assert dep.required_permission == "deployment.approve"
