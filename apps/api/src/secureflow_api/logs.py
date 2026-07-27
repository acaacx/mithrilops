"""Deterministic per-stage logs, ported from @secureflow/mock-data runs.ts."""

from datetime import datetime, timedelta

from .models import PipelineLogLine, PipelineRun, PipelineStage


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def stage_logs(run: PipelineRun, stage_definition_id: str) -> list[PipelineLogLine]:
    stage: PipelineStage | None = next(
        (s for s in run.stages if s.definition_id == stage_definition_id), None
    )
    if not stage or not stage.started_at:
        return []
    t0 = datetime.fromisoformat(stage.started_at.replace("Z", "+00:00"))

    def at(seconds: float) -> str:
        return _iso(t0 + timedelta(seconds=seconds))

    lines = [
        PipelineLogLine(
            timestamp=at(0),
            level="info",
            message=f"Starting '{stage.name}' with {stage.tool} (runner: az-ubuntu-24.04, region: westeurope)",
        ),
        PipelineLogLine(
            timestamp=at(1),
            level="debug",
            message=f"workspace={run.application_id} ref={run.commit.branch} sha={run.commit.sha[:12]}",
        ),
        PipelineLogLine(
            timestamp=at(3),
            level="info",
            message=f"{stage.tool} initialized — policy bundle 2026.07.19 loaded",
        ),
    ]
    if stage.status in ("failed", "blocked"):
        lines += [
            PipelineLogLine(
                timestamp=at(6),
                level="warn",
                message="Gate evaluation started against org policy set 'prod-baseline-v9'",
            ),
            PipelineLogLine(
                timestamp=at(8),
                level="error",
                message=stage.failure_reason or "Stage failed. See findings for details.",
            ),
            PipelineLogLine(
                timestamp=at(9),
                level="error",
                message=(
                    f"Exit code 1 — '{stage.name}' marked as {stage.status}. Evidence bundle "
                    f"uploaded to secureflow-evidence/{run.id}/{stage_definition_id}.tar.gz"
                ),
            ),
        ]
    elif stage.status == "running":
        lines.append(
            PipelineLogLine(timestamp=at(5), level="info", message="Execution in progress…")
        )
    elif stage.status == "waiting-approval":
        lines += [
            PipelineLogLine(
                timestamp=at(4),
                level="info",
                message="All automated gates passed. Awaiting human approval per policy 'prod-dual-approval'.",
            ),
            PipelineLogLine(
                timestamp=at(5),
                level="warn",
                message="Reminder sent to release-approver group (2 pending approvers).",
            ),
        ]
    else:
        duration = stage.duration_seconds if stage.duration_seconds is not None else 8
        lines += [
            PipelineLogLine(
                timestamp=at(5),
                level="info",
                message=f"{stage.tool} completed with 0 blocking violations",
            ),
            PipelineLogLine(
                timestamp=at(duration),
                level="info",
                message=(
                    f"'{stage.name}' succeeded in {duration}s — evidence sealed "
                    f"(sha256:{run.commit.sha[:16]}…)"
                ),
            ),
        ]
    return lines
