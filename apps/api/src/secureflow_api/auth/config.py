"""Auth configuration from environment. AUTH_ENABLED=1 turns enforcement on
and makes missing Entra config fatal; the default keeps every route open for
demos (one loud log line at startup, wired in main.py's lifespan)."""

import os
from dataclasses import dataclass


class AuthConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class AuthConfig:
    enabled: bool
    tenant_id: str = ""
    client_id: str = ""
    jwks_url: str = ""
    issuer: str = ""


def load_auth_config() -> AuthConfig:
    if os.environ.get("AUTH_ENABLED", "0") != "1":
        return AuthConfig(enabled=False)
    tenant_id = os.environ.get("ENTRA_TENANT_ID", "")
    client_id = os.environ.get("ENTRA_CLIENT_ID", "")
    missing = [
        name
        for name, value in (("ENTRA_TENANT_ID", tenant_id), ("ENTRA_CLIENT_ID", client_id))
        if not value
    ]
    if missing:
        raise AuthConfigError(f"AUTH_ENABLED=1 but not set: {', '.join(missing)}")
    return AuthConfig(
        enabled=True,
        tenant_id=tenant_id,
        client_id=client_id,
        jwks_url=os.environ.get("ENTRA_JWKS_URL")
        or f"https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys",
        issuer=f"https://login.microsoftonline.com/{tenant_id}/v2.0",
    )
