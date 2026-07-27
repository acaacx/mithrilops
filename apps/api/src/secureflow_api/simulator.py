"""Server-side pipeline simulator — port of apps/web/src/lib/realtime/simulator.ts.

Advances the designated demo run one stage per tick, publishing typed SSE
events so the SPA (HTTP mode) stays live. The client-side simulator remains
the memory-mode equivalent; keep the two tick implementations in sync.
"""

import asyncio
import logging
import os
from datetime import datetime

from .events import broadcast
from .models import StageFindingRef
from .state import AppState, get_state, now_iso

SIMULATED_RUN_ID = "run-0512"
RESET_INDEX = 11
IDLE_TICKS = 5
STOP_AFTER = "smoke-tests"

_idle_ticks = 0


def reset() -> None:
    global _idle_ticks
    _idle_ticks = 0


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


def tick(state: AppState) -> None:
    global _idle_ticks
    run = next((r for r in state.runs if r.id == SIMULATED_RUN_ID), None)
    if not run:
        return

    if run.status == "succeeded":
        _idle_ticks += 1
        if _idle_ticks < IDLE_TICKS:
            return
        _idle_ticks = 0
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
        dep = next((d for d in state.deployments if d.id == "dep-not-dev"), None)
        if dep:
            dep.argo_sync_status = "synced"
            dep.status = "healthy"
            dep.version = run.artifact_version

    if current.definition_id == STOP_AFTER:
        run.status = "succeeded"
        run.security_gate = "passed"
        run.finished_at = now_iso()
        run.duration_seconds = _seconds_between(run.started_at, run.finished_at)
        for s in run.stages:
            if s.status == "pending":
                s.status = "skipped"
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

    _run_updated(run.id)


async def run_simulator() -> None:
    tick_seconds = float(os.environ.get("SIM_TICK_SECONDS", "7"))
    while True:
        await asyncio.sleep(tick_seconds)
        try:
            tick(get_state())
        except Exception:
            logging.getLogger(__name__).exception("simulator tick failed")
