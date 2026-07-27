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
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from . import data
from .logs import stage_logs
from .models import (
    Application,
    ArchitectureDiagram,
    AuditEvent,
    ComplianceFramework,
    Deployment,
    EnvironmentName,
    InfrastructurePlan,
    Integration,
    PipelineLogLine,
    PipelineRun,
    PipelineRunStatus,
    SecurityFinding,
)

logger = logging.getLogger("secureflow-api")

app = FastAPI(title="SecureFlow API", version="0.1.0", docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("CORS_ORIGIN", "http://localhost:5173")],
    allow_methods=["GET"],
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
async def list_applications() -> list[Application]:
    return data.applications()


@app.get("/api/applications/{app_id}")
async def get_application(app_id: str) -> Application:
    found = next((a for a in data.applications() if a.id == app_id), None)
    if not found:
        raise HTTPException(status_code=404, detail="application_not_found")
    return found


@app.get("/api/runs")
async def list_runs(
    application_id: str | None = Query(default=None, alias="applicationId"),
    status: PipelineRunStatus | None = None,
    environment: EnvironmentName | None = None,
) -> list[PipelineRun]:
    runs = data.pipeline_runs()
    if application_id:
        runs = [r for r in runs if r.application_id == application_id]
    if status:
        runs = [r for r in runs if r.status == status]
    if environment:
        runs = [r for r in runs if r.environment == environment]
    return runs


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str) -> PipelineRun:
    run = next((r for r in data.pipeline_runs() if r.id == run_id), None)
    if not run:
        raise HTTPException(status_code=404, detail="run_not_found")
    return run


@app.get("/api/runs/{run_id}/stages/{stage_id}/logs")
async def get_stage_logs(run_id: str, stage_id: str) -> list[PipelineLogLine]:
    run = next((r for r in data.pipeline_runs() if r.id == run_id), None)
    if not run:
        raise HTTPException(status_code=404, detail="run_not_found")
    return stage_logs(run_id, stage_id)


@app.get("/api/findings")
async def list_findings() -> list[SecurityFinding]:
    return data.security_findings()


@app.get("/api/deployments")
async def list_deployments() -> list[Deployment]:
    return data.deployments()


@app.get("/api/plans")
async def list_plans() -> list[InfrastructurePlan]:
    return data.infrastructure_plans()


@app.get("/api/frameworks")
async def list_frameworks() -> list[ComplianceFramework]:
    return data.compliance_frameworks()


@app.get("/api/audit")
async def list_audit() -> list[AuditEvent]:
    return data.audit_events()


@app.get("/api/findings/{finding_id}")
async def get_finding(finding_id: str) -> SecurityFinding:
    found = next((f for f in data.security_findings() if f.id == finding_id), None)
    if not found:
        raise HTTPException(status_code=404, detail="finding_not_found")
    return found


@app.get("/api/plans/{plan_id}")
async def get_plan(plan_id: str) -> InfrastructurePlan:
    plan = next((p for p in data.infrastructure_plans() if p.id == plan_id), None)
    if not plan:
        raise HTTPException(status_code=404, detail="plan_not_found")
    return plan


@app.get("/api/frameworks/{framework_id}")
async def get_framework(framework_id: str) -> ComplianceFramework:
    fw = next((f for f in data.compliance_frameworks() if f.id == framework_id), None)
    if not fw:
        raise HTTPException(status_code=404, detail="framework_not_found")
    return fw


@app.get("/api/integrations")
async def list_integrations() -> list[Integration]:
    return data.integrations()


@app.get("/api/architecture/{app_id}")
async def get_architecture(app_id: str) -> ArchitectureDiagram:
    diagram = next((d for d in data.architecture_diagrams() if d.application_id == app_id), None)
    if not diagram:
        raise HTTPException(status_code=404, detail="diagram_not_found")
    return diagram


@app.get("/api/events")
async def events() -> StreamingResponse:
    """Server-Sent Events stream of simulated pipeline activity."""

    async def stream():
        yield _sse("hello", {"message": "SecureFlow event stream connected (simulated)"})
        while True:
            await asyncio.sleep(10)
            yield _sse("heartbeat", {"at": datetime.now(timezone.utc).isoformat()})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )


def _sse(event: str, payload: object) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


def run() -> None:
    import uvicorn

    port = int(os.environ.get("API_PORT", "4000"))
    host = os.environ.get("API_HOST", "127.0.0.1")
    logger.info("SecureFlow API listening on http://%s:%s", host, port)
    uvicorn.run("secureflow_api.main:app", host=host, port=port)
