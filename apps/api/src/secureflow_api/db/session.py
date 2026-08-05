# apps/api/src/secureflow_api/db/session.py
"""Request-scoped session dependency. Tests override exactly this function."""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from .engine import get_sessionmaker


async def get_session() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as session:
        yield session
        await session.commit()
