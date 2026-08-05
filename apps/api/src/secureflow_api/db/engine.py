"""Async engine and sessionmaker, created lazily from DATABASE_URL.

Postgres is required: there is no in-memory fallback. A missing or
unreachable database is a startup failure, not a silent degradation.
"""

import os

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def database_url() -> str:
    return os.environ.get(
        "DATABASE_URL",
        "postgresql+asyncpg://postgres:postgres@localhost:5432/secureflow",
    )


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        # NullPool: no idle connections are kept between checkouts. Required
        # because the sync TestClient (test_mutations.py, pre-Task-6) opens a
        # fresh event loop per request when not used as a context manager —
        # a pooled asyncpg connection born on one (now-closed) loop cannot be
        # reused from another, and blows up as "attached to a different loop".
        # A pooled engine is safe once every caller shares one event loop
        # (uvicorn in production, the async `client` fixture in tests).
        # TODO(task-6): revert to pooled engine (pool_pre_ping=True) once
        # test_mutations.py uses the async client and no sync TestClient remains.
        _engine = create_async_engine(database_url(), poolclass=NullPool)
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    global _sessionmaker
    if _sessionmaker is None:
        _sessionmaker = async_sessionmaker(get_engine(), expire_on_commit=False)
    return _sessionmaker


async def dispose_engine() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None
