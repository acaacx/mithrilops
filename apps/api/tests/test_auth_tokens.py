import pytest
from fastapi import HTTPException

from secureflow_api.auth.config import load_auth_config
from secureflow_api.auth.dependencies import authenticate


def test_valid_token_yields_principal(auth_enabled, make_token):
    principal = authenticate(make_token(roles=["developer"]), load_auth_config())
    assert principal.sub == "user-123"
    assert principal.name == "Test User"
    assert principal.roles == ("developer",)


def test_multiple_roles_union(auth_enabled, make_token):
    principal = authenticate(
        make_token(roles=["developer", "compliance-reviewer"]), load_auth_config()
    )
    assert "compliance.review" in principal.permissions
    assert "pipeline.trigger" in principal.permissions


def test_unknown_roles_ignored(auth_enabled, make_token):
    principal = authenticate(
        make_token(roles=["developer", "galactic-emperor"]), load_auth_config()
    )
    assert principal.roles == ("developer",)


def test_no_valid_roles_yields_permissionless_principal(auth_enabled, make_token):
    principal = authenticate(make_token(roles=[]), load_auth_config())
    assert principal.permissions == frozenset()


def test_name_falls_back_to_sub(auth_enabled, make_token):
    principal = authenticate(make_token(drop=("name",)), load_auth_config())
    assert principal.name == "user-123"


@pytest.mark.parametrize(
    "kwargs",
    [
        {"exp_delta": -120},                       # expired (beyond 60s leeway)
        {"aud": "api://someone-else"},             # wrong audience
        {"iss": "https://evil.example/v2.0"},      # wrong issuer
        {"kid": "no-such-kid"},                    # unknown kid
        {"drop": ("sub",)},                        # missing required claim
    ],
    ids=["expired", "wrong-aud", "wrong-iss", "unknown-kid", "missing-sub"],
)
def test_invalid_tokens_401(auth_enabled, make_token, kwargs):
    with pytest.raises(HTTPException) as exc:
        authenticate(make_token(**kwargs), load_auth_config())
    assert exc.value.status_code == 401
    assert exc.value.headers["WWW-Authenticate"] == "Bearer"


def test_wrong_signing_key_401(auth_enabled, make_token, auth_keys):
    token = make_token(key=auth_keys[1])  # imposter key, same kid
    with pytest.raises(HTTPException) as exc:
        authenticate(token, load_auth_config())
    assert exc.value.status_code == 401


def test_hs256_downgrade_401(auth_enabled, make_token):
    token = make_token(key="shared-secret", alg="HS256")
    with pytest.raises(HTTPException) as exc:
        authenticate(token, load_auth_config())
    assert exc.value.status_code == 401


def test_garbage_token_401(auth_enabled):
    with pytest.raises(HTTPException) as exc:
        authenticate("not.a.jwt", load_auth_config())
    assert exc.value.status_code == 401
