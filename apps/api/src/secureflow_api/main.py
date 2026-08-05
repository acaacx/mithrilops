"""SecureFlow API scaffold (FastAPI). Same routes and JSON contract as the
previous Fastify implementation; the SPA needs no changes.

Extension points:
- Auth: replace the allow-all dependency with Entra ID (OIDC) bearer-token
  validation. Every privileged route must additionally check role permissions
  server-side.
- Persistence: swap data.py fixture loaders for PostgreSQL + SQLAlchemy.
- Events: fan out real events from Redis pub/sub instead of the heartbeat timer.
"""

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from .clock import now_iso
from .db import migrate, repositories, seed
from .db.engine import dispose_engine, get_sessionmaker
from .db.session import get_session
from .events import broadcast
from .logs import stage_logs
from .simulator import run_simulator
from .models import (
    Application,
    Approval,
    ApprovalBody,
    ArchitectureDiagram,
    AuditEvent,
    AuditRecordBody,
    ComplianceFramework,
    Deployment,
    EnvironmentName,
    FindingStatusBody,
    InfrastructurePlan,
    Integration,
    PipelineLogLine,
    PipelineRun,
    PipelineRunStatus,
    PromoteBody,
    RollbackBody,
    SecurityFinding,
    SuppressionEntry,
)

logger = logging.getLogger("secureflow-api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await asyncio.to_thread(migrate.upgrade_to_head)
    async with get_sessionmaker()() as session:
        if await seed.ensure_seeded(session):
            logger.info("database seeded from fixtures")
        await session.commit()
    task = None
    if os.environ.get("SIM_ENABLED", "1") != "0":
        task = asyncio.create_task(run_simulator())
    yield
    if task:
        task.cancel()
    await dispose_engine()


app = FastAPI(
    title="SecureFlow API", version="0.1.0", docs_url=None, redoc_url=None, lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("CORS_ORIGIN", "http://localhost:5173")],
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    # Same posture as the previous helmet config; rate limiting is an extension
    # point (edge/API gateway in production).
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; frame-ancestors 'none'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "mode": "mock"}


@app.get("/api/applications")
async def list_applications(session: AsyncSession = Depends(get_session)) -> list[Application]:
    return await repositories.applications.list(session)


@app.get("/api/applications/{app_id}")
async def get_application(
    app_id: str, session: AsyncSession = Depends(get_session)
) -> Application:
    found = await repositories.applications.get(session, app_id)
    if not found:
        raise HTTPException(status_code=404, detail="application_not_found")
    return found


@app.get("/api/runs")
async def list_runs(
    application_id: str | None = Query(default=None, alias="applicationId"),
    status: PipelineRunStatus | None = None,
    environment: EnvironmentName | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[PipelineRun]:
    return await repositories.runs.list(
        session, application_id=application_id, status=status, environment=environment
    )


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str, session: AsyncSession = Depends(get_session)) -> PipelineRun:
    run = await repositories.runs.get(session, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run_not_found")
    return run


@app.get("/api/runs/{run_id}/stages/{stage_id}/logs")
async def get_stage_logs(
    run_id: str, stage_id: str, session: AsyncSession = Depends(get_session)
) -> list[PipelineLogLine]:
    run = await repositories.runs.get(session, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run_not_found")
    stage = next(
        (s for s in run.stages if s.id == stage_id or s.definition_id == stage_id), None
    )
    if not stage:
        return []
    return stage_logs(run, stage.definition_id)


@app.get("/api/findings")
async def list_findings(
    session: AsyncSession = Depends(get_session),
) -> list[SecurityFinding]:
    return await repositories.findings.list(session)


@app.get("/api/deployments")
async def list_deployments(session: AsyncSession = Depends(get_session)) -> list[Deployment]:
    return await repositories.deployments.list(session)


@app.get("/api/plans")
async def list_plans(
    session: AsyncSession = Depends(get_session),
) -> list[InfrastructurePlan]:
    return await repositories.plans.list(session)


@app.get("/api/frameworks")
async def list_frameworks(
    session: AsyncSession = Depends(get_session),
) -> list[ComplianceFramework]:
    return await repositories.frameworks.list(session)


@app.get("/api/audit")
async def list_audit(session: AsyncSession = Depends(get_session)) -> list[AuditEvent]:
    return await repositories.audit.list(session)


@app.get("/api/findings/{finding_id}")
async def get_finding(
    finding_id: str, session: AsyncSession = Depends(get_session)
) -> SecurityFinding:
    found = await repositories.findings.get(session, finding_id)
    if not found:
        raise HTTPException(status_code=404, detail="finding_not_found")
    return found


@app.get("/api/plans/{plan_id}")
async def get_plan(
    plan_id: str, session: AsyncSession = Depends(get_session)
) -> InfrastructurePlan:
    plan = await repositories.plans.get(session, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="plan_not_found")
    return plan


@app.get("/api/frameworks/{framework_id}")
async def get_framework(
    framework_id: str, session: AsyncSession = Depends(get_session)
) -> ComplianceFramework:
    fw = await repositories.frameworks.get(session, framework_id)
    if not fw:
        raise HTTPException(status_code=404, detail="framework_not_found")
    return fw


@app.get("/api/integrations")
async def list_integrations(session: AsyncSession = Depends(get_session)) -> list[Integration]:
    return await repositories.integrations.list(session)


@app.get("/api/architecture/{app_id}")
async def get_architecture(
    app_id: str, session: AsyncSession = Depends(get_session)
) -> ArchitectureDiagram:
    found = await repositories.diagrams.list(session, application_id=app_id)
    if not found:
        raise HTTPException(status_code=404, detail="diagram_not_found")
    return found[0]


@app.get("/api/events")
async def events() -> StreamingResponse:
    """SSE stream: simulator events plus a 10s heartbeat."""

    async def stream():
        queue = broadcast.subscribe()
        try:
            yield _sse("hello", {"message": "SecureFlow event stream connected (simulated)"})
            while True:
                try:
                    event, payload = await asyncio.wait_for(queue.get(), timeout=10)
                    yield _sse(event, payload)
                except asyncio.TimeoutError:
                    yield _sse("heartbeat", {"at": datetime.now(timezone.utc).isoformat()})
        finally:
            broadcast.unsubscribe(queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )


def _sse(event: str, payload: object) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


@app.post("/api/runs/{run_id}/stages/{stage_id}/retry", status_code=204)
async def retry_stage(
    run_id: str, stage_id: str, session: AsyncSession = Depends(get_session)
) -> None:
    run = await repositories.runs.get(session, run_id, for_update=True)
    stage = (
        next((s for s in run.stages if s.id == stage_id or s.definition_id == stage_id), None)
        if run
        else None
    )
    if not run or not stage:
        raise HTTPException(status_code=404, detail="stage_not_found")
    stage.status = "running"
    stage.failure_reason = None
    stage.started_at = now_iso()
    stage.finished_at = None
    run.status = "running"
    await repositories.runs.save(session, run)
    await repositories.audit.record(
        session,
        actor="You",
        actor_role="devsecops-engineer",
        action="stage.retried",
        target=f"{run_id} / {stage.definition_id}",
        target_type="PipelineStage",
        outcome="success",
        detail=f"Manual retry of '{stage.name}'.",
    )


@app.get("/api/runs/{run_id}/approvals")
async def list_approvals(
    run_id: str, session: AsyncSession = Depends(get_session)
) -> list[Approval]:
    if not await repositories.runs.get(session, run_id):
        raise HTTPException(status_code=404, detail="run_not_found")
    return await repositories.approvals.list(session, run_id=run_id)


@app.post("/api/runs/{run_id}/approval", status_code=204)
async def approve_deployment(
    run_id: str, body: ApprovalBody, session: AsyncSession = Depends(get_session)
) -> None:
    run = await repositories.runs.get(session, run_id, for_update=True)
    if not run:
        raise HTTPException(status_code=404, detail="run_not_found")
    run.approval_status = body.decision
    pending = next(
        (
            a
            for a in await repositories.approvals.list(session, run_id=run_id)
            if a.decision == "pending"
        ),
        None,
    )
    if pending:
        pending.decision = body.decision
        pending.decided_by = "You"
        pending.decided_at = now_iso()
        pending.comment = body.comment
        await repositories.approvals.save(session, pending)
    if body.decision == "approved":
        run.status = "running"
        stage = next((s for s in run.stages if s.status == "waiting-approval"), None)
        if stage:
            stage.status = "succeeded"
            stage.finished_at = now_iso()
    else:
        run.status = "cancelled" if body.decision == "rejected" else "blocked"
    await repositories.runs.save(session, run)


@app.patch("/api/findings/{finding_id}/status", status_code=204)
async def update_finding_status(
    finding_id: str, body: FindingStatusBody, session: AsyncSession = Depends(get_session)
) -> None:
    finding = await repositories.findings.get(session, finding_id, for_update=True)
    if not finding:
        raise HTTPException(status_code=404, detail="finding_not_found")
    finding.status = body.status
    if body.reason:
        finding.suppression_history.append(
            SuppressionEntry(date=now_iso(), by="You", reason=body.reason)
        )
    await repositories.findings.save(session, finding)
    await repositories.audit.record(
        session,
        actor="You",
        actor_role="security-engineer",
        action="finding.status-changed",
        target=f"{finding_id} → {body.status}",
        target_type="SecurityFinding",
        outcome="success",
        detail=body.reason or "Status updated from the security command center.",
    )


@app.post("/api/applications/{app_id}/sync", status_code=204)
async def sync_application(app_id: str, session: AsyncSession = Depends(get_session)) -> None:
    if not await repositories.applications.get(session, app_id):
        raise HTTPException(status_code=404, detail="application_not_found")
    for d in await repositories.deployments.list(session, application_id=app_id):
        d.argo_sync_status = "synced"
        await repositories.deployments.save(session, d)


ENV_ORDER: list[EnvironmentName] = ["development", "test", "staging", "production"]


@app.post("/api/applications/{app_id}/promote", status_code=204)
async def promote(
    app_id: str, body: PromoteBody, session: AsyncSession = Depends(get_session)
) -> None:
    if not await repositories.applications.get(session, app_id):
        raise HTTPException(status_code=404, detail="application_not_found")
    from_index = ENV_ORDER.index(body.to_environment) - 1
    from_env = ENV_ORDER[from_index] if from_index >= 0 else None
    deployments = await repositories.deployments.list(session, application_id=app_id)
    source = next((d for d in deployments if d.environment == from_env), None)
    target = next((d for d in deployments if d.environment == body.to_environment), None)
    if source and target:
        target.previous_version = target.version
        target.version = source.version
        target.status = "progressing"
        target.argo_sync_status = "syncing"
        target.deployed_at = now_iso()
        target.deployed_by = "You (promotion)"
        await repositories.deployments.save(session, target)
    await repositories.audit.record(
        session,
        actor="You",
        actor_role="release-approver",
        action="deployment.promoted",
        target=f"{app_id} → {body.to_environment}",
        target_type="Deployment",
        outcome="success",
        detail=f"Promoted {source.version if source else 'latest'} to {body.to_environment}.",
    )


@app.post("/api/applications/{app_id}/rollback", status_code=204)
async def rollback(
    app_id: str, body: RollbackBody, session: AsyncSession = Depends(get_session)
) -> None:
    if not await repositories.applications.get(session, app_id):
        raise HTTPException(status_code=404, detail="application_not_found")
    prod = next(
        (
            d
            for d in await repositories.deployments.list(session, application_id=app_id)
            if d.environment == "production"
        ),
        None,
    )
    if prod:
        prod.previous_version = prod.version
        prod.version = body.revision
        prod.status = "rolled-back"
        prod.deployed_at = now_iso()
        prod.deployed_by = "You (manual rollback)"
        await repositories.deployments.save(session, prod)
    await repositories.audit.record(
        session,
        actor="You",
        actor_role="release-approver",
        action="deployment.rolled-back",
        target=f"{app_id} production → {body.revision}",
        target_type="Deployment",
        outcome="success",
        detail=f"Manual rollback to {body.revision}.",
    )


@app.post("/api/demo/reset", status_code=204)
async def demo_reset(session: AsyncSession = Depends(get_session)) -> None:
    if os.environ.get("DEMO_RESET_ENABLED", "0") != "1":
        # 404, not 403: production does not advertise an endpoint it refuses.
        # Fail closed: the endpoint is absent unless explicitly enabled.
        raise HTTPException(status_code=404, detail="not_found")
    await seed.reset_demo(session)
    await session.commit()
    broadcast.publish("state-reset", {"at": now_iso()})


@app.post("/api/audit", status_code=201)
async def record_audit_event(
    body: AuditRecordBody, session: AsyncSession = Depends(get_session)
) -> AuditEvent:
    return await repositories.audit.record(
        session,
        actor=body.actor,
        actor_role=body.actor_role,
        action=body.action,
        target=body.target,
        target_type=body.target_type,
        outcome=body.outcome,
        detail=body.detail,
    )


def run() -> None:
    import uvicorn

    port = int(os.environ.get("API_PORT", "4000"))
    host = os.environ.get("API_HOST", "127.0.0.1")
    logger.info("SecureFlow API listening on http://%s:%s", host, port)
    uvicorn.run("secureflow_api.main:app", host=host, port=port)
