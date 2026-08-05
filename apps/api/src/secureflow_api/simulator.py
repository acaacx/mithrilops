"""Server-side pipeline simulator — port of apps/web/src/lib/realtime/simulator.ts.

Advances the designated demo run one stage per tick, publishing typed SSE
events so the SPA (HTTP mode) stays live. The client-side simulator remains
the memory-mode equivalent; keep the two tick implementations in sync.
"""

import asyncio
import logging
import os
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .clock import now_iso
from .db import repositories
from .db.engine import get_engine, get_sessionmaker
from .events import broadcast
from .models import StageFindingRef

SIMULATED_RUN_ID = "run-0512"
RESET_INDEX = 11
STOP_AFTER = "smoke-tests"
TICKER_LOCK_KEY = 715003

IDLE_SECONDS = float(os.environ.get("SIM_IDLE_SECONDS", "35"))


def _idle_elapsed(finished_at: str | None) -> bool:
    if not finished_at:
        return True
    t = datetime.fromisoformat(finished_at.replace("Z", "+00:00"))
    return (datetime.now(timezone.utc) - t).total_seconds() > IDLE_SECONDS


def _seconds_between(start: str | None, end: str) -> int:
    if not start:
        return 0
    t0 = datetime.fromisoformat(start.replace("Z", "+00:00"))
    t1 = datetime.fromisoformat(end.replace("Z", "+00:00"))
    return max(0, round((t1 - t0).total_seconds()))


def _notify(title: str, body: str, kind: str) -> None:
    broadcast.publish("notification", {"title": title, "body": body, "kind": kind})


def _run_updated(run_id: str) -> None:
    broadcast.publish("run-updated", {"runId": run_id})


async def tick(session: AsyncSession) -> None:
    # FOR UPDATE: the simulated run is the one row both the simulator and the
    # request handlers write; the lock serializes the only real race. All
    # other writes in the app are last-write-wins by design.
    run = await repositories.runs.get(session, SIMULATED_RUN_ID, for_update=True)
    if not run:
        return

    if run.status == "succeeded":
        if not _idle_elapsed(run.finished_at):
            return
        run.status = "running"
        run.security_gate = "in-progress"
        run.finished_at = None
        run.duration_seconds = None
        run.started_at = now_iso()
        for stage in run.stages[RESET_INDEX:]:
            stage.status = "pending"
            stage.started_at = None
            stage.finished_at = None
            stage.duration_seconds = None
            stage.findings = []
        first = run.stages[RESET_INDEX]
        first.status = "running"
        first.started_at = now_iso()
        await repositories.runs.save(session, run)
        _notify(
            "Pipeline started",
            f"notification-worker {run.artifact_version} — new execution began.",
            "info",
        )
        _run_updated(run.id)
        return

    if run.status != "running":
        return

    idx = next((i for i, s in enumerate(run.stages) if s.status == "running"), -1)
    if idx == -1:
        return
    current = run.stages[idx]

    current.status = "succeeded"
    current.finished_at = now_iso()
    current.duration_seconds = _seconds_between(current.started_at, current.finished_at)
    if current.blocks_deployment:
        current.evidence_ids = [f"ev-{run.id}-{current.definition_id}"]

    if current.definition_id == "image-scan" and not current.findings:
        current.findings = [
            StageFindingRef(
                finding_id="find-missing-limits",
                severity="medium",
                title="Base image: 2 medium CVEs (below gate threshold)",
            )
        ]
        _notify(
            "Findings detected during scan",
            "Trivy reported 2 medium CVEs in notification-worker — below the blocking threshold.",
            "warning",
        )

    if current.definition_id == "argo-sync":
        dep = await repositories.deployments.get(session, "dep-not-dev")
        if dep:
            dep.argo_sync_status = "synced"
            dep.status = "healthy"
            dep.version = run.artifact_version
            await repositories.deployments.save(session, dep)

    if current.definition_id == STOP_AFTER:
        run.status = "succeeded"
        run.security_gate = "passed"
        run.finished_at = now_iso()
        run.duration_seconds = _seconds_between(run.started_at, run.finished_at)
        for s in run.stages:
            if s.status == "pending":
                s.status = "skipped"
        await repositories.runs.save(session, run)
        _notify(
            "Pipeline succeeded",
            f"notification-worker {run.artifact_version} verified in development.",
            "success",
        )
        _run_updated(run.id)
        return

    if idx + 1 < len(run.stages):
        nxt = run.stages[idx + 1]
        nxt.status = "running"
        nxt.started_at = now_iso()
        if nxt.definition_id in ("manual-approval", "prod-approval"):
            nxt.status = "succeeded"
            nxt.finished_at = now_iso()
            nxt.duration_seconds = 1
            if idx + 2 < len(run.stages):
                after = run.stages[idx + 2]
                after.status = "running"
                after.started_at = now_iso()

    await repositories.runs.save(session, run)
    _run_updated(run.id)


async def run_simulator() -> None:
    tick_seconds = float(os.environ.get("SIM_TICK_SECONDS", "7"))
    maker = get_sessionmaker()
    # Session-level advisory lock on a dedicated connection, held for the
    # process lifetime: exactly one replica drives the demo.
    async with get_engine().connect() as lock_conn:
        got = (
            await lock_conn.execute(
                text("SELECT pg_try_advisory_lock(:key)"), {"key": TICKER_LOCK_KEY}
            )
        ).scalar()
        if not got:
            logging.getLogger(__name__).info("another replica holds the ticker lock; idle")
            return
        # Commit the advisory-lock transaction; the lock survives commit and we
        # avoid holding the connection idle-in-transaction for the process lifetime.
        await lock_conn.commit()
        while True:
            await asyncio.sleep(tick_seconds)
            try:
                async with maker() as session:
                    await tick(session)
                    await session.commit()
            except Exception:
                logging.getLogger(__name__).exception("simulator tick failed")
