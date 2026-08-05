"""Programmatic `alembic upgrade head`. Sync on purpose — env.py owns its own
event loop, so callers inside a running loop must use asyncio.to_thread.
"""

from pathlib import Path

from alembic import command
from alembic.config import Config

ALEMBIC_INI = Path(__file__).resolve().parents[3] / "alembic.ini"


def upgrade_to_head() -> None:
    command.upgrade(Config(str(ALEMBIC_INI)), "head")
