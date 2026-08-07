import pytest

from secureflow_api.auth.config import AuthConfig, AuthConfigError, load_auth_config


def test_disabled_by_default(monkeypatch):
    monkeypatch.delenv("AUTH_ENABLED", raising=False)
    config = load_auth_config()
    assert config == AuthConfig(enabled=False)


def test_enabled_requires_tenant_and_client(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "1")
    monkeypatch.delenv("ENTRA_TENANT_ID", raising=False)
    monkeypatch.delenv("ENTRA_CLIENT_ID", raising=False)
    with pytest.raises(AuthConfigError, match="ENTRA_TENANT_ID"):
        load_auth_config()


def test_enabled_derives_issuer_and_jwks_url(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "1")
    monkeypatch.setenv("ENTRA_TENANT_ID", "tenant-guid")
    monkeypatch.setenv("ENTRA_CLIENT_ID", "api://client")
    monkeypatch.delenv("ENTRA_JWKS_URL", raising=False)
    config = load_auth_config()
    assert config.enabled is True
    assert config.issuer == "https://login.microsoftonline.com/tenant-guid/v2.0"
    assert config.jwks_url == "https://login.microsoftonline.com/tenant-guid/discovery/v2.0/keys"


def test_jwks_url_override(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "1")
    monkeypatch.setenv("ENTRA_TENANT_ID", "tenant-guid")
    monkeypatch.setenv("ENTRA_CLIENT_ID", "api://client")
    monkeypatch.setenv("ENTRA_JWKS_URL", "http://localhost:9999/jwks.json")
    assert load_auth_config().jwks_url == "http://localhost:9999/jwks.json"
