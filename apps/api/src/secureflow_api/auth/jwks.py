"""Cached JWKS clients. The URL is the test seam: tests patch
PyJWKClient.fetch_data so kid lookup and key parsing run for real, offline."""

from functools import lru_cache

from jwt import PyJWKClient


@lru_cache(maxsize=4)
def _client(url: str) -> PyJWKClient:
    return PyJWKClient(url, cache_keys=True)


def signing_key_for(token: str, url: str):
    return _client(url).get_signing_key_from_jwt(token).key
