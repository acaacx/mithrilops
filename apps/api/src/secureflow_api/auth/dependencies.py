"""Token validation and the FastAPI auth dependencies."""

import logging
from typing import get_args

import jwt
from fastapi import HTTPException
from jwt import InvalidTokenError, PyJWKClientError

from ..models import Role
from . import jwks
from .config import AuthConfig
from .principal import Principal

logger = logging.getLogger("secureflow-api")

_KNOWN_ROLES: frozenset[str] = frozenset(get_args(Role))


def _unauthorized() -> HTTPException:
    # Generic detail on purpose: never echo claims or validation specifics.
    return HTTPException(
        status_code=401, detail="invalid_token", headers={"WWW-Authenticate": "Bearer"}
    )


def authenticate(token: str, config: AuthConfig) -> Principal:
    try:
        key = jwks.signing_key_for(token, config.jwks_url)
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=config.client_id,
            issuer=config.issuer,
            leeway=60,
            options={"require": ["exp", "iat", "sub"]},
        )
    except (InvalidTokenError, PyJWKClientError):
        raise _unauthorized() from None
    raw_roles = claims.get("roles") or []
    roles = tuple(r for r in raw_roles if r in _KNOWN_ROLES)
    unknown = [r for r in raw_roles if r not in _KNOWN_ROLES]
    if unknown:
        logger.warning("ignoring unknown roles in token: %s", unknown)
    name = claims.get("name") or claims.get("preferred_username") or claims["sub"]
    return Principal(sub=claims["sub"], name=name, roles=roles)
