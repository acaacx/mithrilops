# SPA → FastAPI HTTP Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the SecureFlow SPA to the FastAPI backend over HTTP (default mode) while keeping in-memory providers as a switchable mode, with server-side mutations, a server-side pipeline simulator streaming typed SSE events, and an `http-smoke` Playwright project in CI.

**Architecture:** The SPA's single data seam is `apps/web/src/lib/providers/index.ts` (consumed only by `lib/queries.ts` via named exports). It becomes a factory selecting mock or HTTP implementations by `VITE_DATA_SOURCE`. The FastAPI app gains a mutable in-memory state store seeded from JSON fixtures, mutation endpoints mirroring the mock providers, and a ported tick-loop simulator that publishes typed SSE events consumed by an EventSource client in HTTP mode.

**Tech Stack:** React 18 + TypeScript + TanStack Query + Vite (pnpm workspace `@secureflow/web`); FastAPI + Pydantic v2 (uv workspace `secureflow-api`, Python ≥3.12); Playwright; vitest; pytest.

**Spec:** `docs/superpowers/specs/2026-07-27-http-provider-wiring-design.md`

## Global Constraints

- JSON contract is camelCase end-to-end; Python models use snake_case fields with the `to_camel` alias generator (`ApiModel` in `apps/api/src/secureflow_api/models.py`). Never break this.
- Fixture export must stay deterministic: `packages/mock-data/scripts/export-fixtures.ts` pins `MOCK_NOW = 2026-07-27T00:00:00.000Z` before a dynamic import. New fixture writes go through the same script.
- Existing green gates must stay green: 28 vitest tests, 10 Playwright e2e (memory mode), 9 pytest tests, `pnpm lint`, `pnpm typecheck`, `pnpm --filter @secureflow/web build`.
- Commit messages: conventional commits, **no AI attribution trailers** (repo rule).
- Run all pnpm commands from repo root (`/Users/alaric/mithrilops`); pytest via `uv run --package secureflow-api pytest apps/api/tests`.
- `import.meta.env.VITE_DATA_SOURCE`: `"memory"` selects mock providers; anything else (including unset) selects HTTP.
- API port 4000 (`API_PORT` env), web dev server port 5173.

---

### Task 1: Missing GET endpoints + integrations/diagrams fixtures

The SPA provider interfaces (`packages/types/src/providers.ts`) need five endpoints the API lacks: `GET /api/findings/{id}`, `GET /api/plans/{id}`, `GET /api/frameworks/{id}`, `GET /api/architecture/{applicationId}`, `GET /api/integrations`. The last two need new fixtures.

**Files:**
- Modify: `packages/mock-data/scripts/export-fixtures.ts`
- Modify: `apps/api/src/secureflow_api/models.py`
- Modify: `apps/api/src/secureflow_api/data.py`
- Modify: `apps/api/src/secureflow_api/main.py`
- Test: `apps/api/tests/test_api.py`

**Interfaces:**
- Consumes: existing `data.py` loader pattern, `ApiModel` base.
- Produces: `data.integrations() -> list[Integration]`, `data.architecture_diagrams() -> list[ArchitectureDiagram]`; models `Integration`, `ArchitectureDiagram`, `ArchitectureNodeData`, `ArchitectureEdge`; the five GET routes. Task 2 moves reads to the state store; Task 6's HTTP providers call these routes.

- [ ] **Step 1: Write failing tests**

Append to `apps/api/tests/test_api.py`:

```python
def test_finding_by_id_and_404():
    findings = client.get("/api/findings").json()
    found = client.get(f"/api/findings/{findings[0]['id']}")
    assert found.status_code == 200
    assert found.json()["id"] == findings[0]["id"]
    assert client.get("/api/findings/nope").status_code == 404


def test_plan_by_id_and_404():
    plans = client.get("/api/plans").json()
    assert client.get(f"/api/plans/{plans[0]['id']}").json()["id"] == plans[0]["id"]
    assert client.get("/api/plans/nope").status_code == 404


def test_framework_by_id_and_404():
    fw = client.get("/api/frameworks").json()[0]
    assert client.get(f"/api/frameworks/{fw['id']}").json()["id"] == fw["id"]
    assert client.get("/api/frameworks/nope").status_code == 404


def test_integrations_list():
    integrations = client.get("/api/integrations").json()
    assert len(integrations) > 0
    assert "lastSyncAt" in integrations[0] or "description" in integrations[0]


def test_architecture_diagram_and_404():
    apps = client.get("/api/applications").json()
    diagram = client.get(f"/api/architecture/{apps[0]['id']}")
    assert diagram.status_code == 200
    body = diagram.json()
    assert body["applicationId"] == apps[0]["id"]
    assert len(body["nodes"]) > 0
    assert client.get("/api/architecture/nope").status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run --package secureflow-api pytest apps/api/tests -v`
Expected: the five new tests FAIL (404 on `/api/integrations`, `/api/architecture/...`; detail-route misses).

- [ ] **Step 3: Export new fixtures**

In `packages/mock-data/scripts/export-fixtures.ts`, extend the destructure and writes (the dataset already exports `integrations` from `src/operations.ts` and `architectureDiagrams` from `src/applications.ts`):

```ts
const {
  applications,
  architectureDiagrams,
  auditEvents,
  complianceFrameworks,
  deployments,
  infrastructurePlans,
  integrations,
  pipelineRuns,
  securityFindings,
} = await import("../src/index");
```

and after the existing `write(...)` calls:

```ts
write("integrations", integrations);
write("diagrams", architectureDiagrams);
```

Run: `pnpm --filter @secureflow/mock-data export:fixtures`
Expected: `apps/api/data/integrations.json` and `apps/api/data/diagrams.json` created; **no diff** in the seven existing fixture files (deterministic clock).

- [ ] **Step 4: Add Pydantic models**

Append to `apps/api/src/secureflow_api/models.py` (mirrors `Integration`, `ArchitectureNodeData`, `ArchitectureDiagram` in `packages/types/src/entities.ts`):

```python
IntegrationStatus = Literal["connected", "degraded", "disconnected", "simulated"]
IntegrationCategory = Literal[
    "scm", "ci", "security", "registry", "iac", "cd", "observability", "identity", "tracking"
]


class Integration(ApiModel):
    id: str
    name: str
    category: IntegrationCategory
    status: IntegrationStatus
    last_sync_at: str | None = None
    description: str


class ArchitectureNodeData(ApiModel):
    id: str
    label: str
    kind: str
    status: Literal["healthy", "warning", "critical", "unknown"]
    owner: str
    description: str
    findings_count: int
    dependencies: list[str]
    related_stage_definition_ids: list[str]


class ArchitectureEdge(ApiModel):
    id: str
    source: str
    target: str
    label: str | None = None


class ArchitectureDiagram(ApiModel):
    id: str
    application_id: str
    nodes: list[ArchitectureNodeData]
    edges: list[ArchitectureEdge]
```

- [ ] **Step 5: Add loaders**

Append to `apps/api/src/secureflow_api/data.py` (add `ArchitectureDiagram, Integration` to the models import):

```python
@cache
def integrations() -> list[Integration]:
    return _load("integrations", TypeAdapter(list[Integration]))


@cache
def architecture_diagrams() -> list[ArchitectureDiagram]:
    return _load("diagrams", TypeAdapter(list[ArchitectureDiagram]))
```

- [ ] **Step 6: Add routes**

In `apps/api/src/secureflow_api/main.py`, add `ArchitectureDiagram, Integration` to the models import and add after the existing GET routes:

```python
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
```

Route-ordering note: `/api/findings/{finding_id}` must be declared **after** `/api/findings` is fine either way in FastAPI (exact static paths win), but keep detail routes below their list routes for readability.

- [ ] **Step 7: Run tests to verify they pass**

Run: `uv run --package secureflow-api pytest apps/api/tests -v`
Expected: all pass (9 existing + 5 new = 14).

- [ ] **Step 8: Commit**

```bash
git add packages/mock-data/scripts/export-fixtures.ts apps/api
git commit -m "feat(api): add detail/integrations/architecture endpoints with fixtures"
```

---

### Task 2: Mutable state store + pytest reset fixture

**Files:**
- Create: `apps/api/src/secureflow_api/state.py`
- Create: `apps/api/tests/conftest.py`
- Modify: `apps/api/src/secureflow_api/main.py` (all GET routes read state)
- Modify: `apps/api/src/secureflow_api/logs.py` (take the run as a parameter)
- Test: `apps/api/tests/test_state.py`

**Interfaces:**
- Consumes: `data.*` loaders from Task 1.
- Produces: `state.AppState` (dataclass with fields `applications, runs, findings, deployments, plans, frameworks, audit, integrations, diagrams, audit_counter`), `state.get_state() -> AppState`, `state.reset_state() -> None`, `state.record_audit(state, *, actor, actor_role, action, target, target_type, outcome, detail) -> AuditEvent`, `state.now_iso() -> str`. Tasks 3–4 mutate this state. `logs.stage_logs(run: PipelineRun, stage_definition_id: str)` new signature.

- [ ] **Step 1: Write failing tests**

Create `apps/api/tests/test_state.py`:

```python
from secureflow_api import state


def test_state_is_seeded_and_isolated_from_fixture_cache():
    st = state.get_state()
    assert len(st.runs) > 0
    original_status = st.runs[0].status
    st.runs[0].status = "cancelled"
    state.reset_state()
    assert state.get_state().runs[0].status == original_status


def test_record_audit_prepends_event_with_sequential_id():
    st = state.get_state()
    before = len(st.audit)
    event = state.record_audit(
        st,
        actor="You",
        actor_role="devsecops-engineer",
        action="test.action",
        target="unit-test",
        target_type="Test",
        outcome="success",
        detail="unit test event",
    )
    assert event.id == "aud-101"
    assert len(st.audit) == before + 1
    assert st.audit[0].id == event.id
    assert state.record_audit(
        st,
        actor="You",
        actor_role="devsecops-engineer",
        action="test.action",
        target="unit-test",
        target_type="Test",
        outcome="success",
        detail="second",
    ).id == "aud-102"
```

Create `apps/api/tests/conftest.py`:

```python
import pytest

from secureflow_api import state


@pytest.fixture(autouse=True)
def fresh_state():
    state.reset_state()
    yield
    state.reset_state()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_state.py -v`
Expected: FAIL with `ModuleNotFoundError` / import error (no `state` module).

- [ ] **Step 3: Implement `state.py`**

Create `apps/api/src/secureflow_api/state.py`:

```python
"""Mutable in-memory state, seeded from the JSON fixtures on first access.

Mutations (retries, approvals, promotions, rollbacks, finding updates, the
simulator) act on this state so HTTP mode behaves statefully within a
process. State is per-process and resets on restart — acceptable for a
labeled mock. reset_state() restores the seed; used by pytest.

Extension point: replace with PostgreSQL + SQLAlchemy repositories.
"""

from dataclasses import dataclass
from datetime import datetime, timezone

from . import data
from .models import (
    Application,
    ArchitectureDiagram,
    AuditEvent,
    ComplianceFramework,
    Deployment,
    InfrastructurePlan,
    Integration,
    PipelineRun,
    Role,
    SecurityFinding,
)


@dataclass
class AppState:
    applications: list[Application]
    runs: list[PipelineRun]
    findings: list[SecurityFinding]
    deployments: list[Deployment]
    plans: list[InfrastructurePlan]
    frameworks: list[ComplianceFramework]
    audit: list[AuditEvent]
    integrations: list[Integration]
    diagrams: list[ArchitectureDiagram]
    # Fixture audit ids run aud-1..aud-10; runtime ids start at aud-101 to
    # match the SPA mock's counter and avoid collisions.
    audit_counter: int = 100


def _seed() -> AppState:
    return AppState(
        applications=[a.model_copy(deep=True) for a in data.applications()],
        runs=[r.model_copy(deep=True) for r in data.pipeline_runs()],
        findings=[f.model_copy(deep=True) for f in data.security_findings()],
        deployments=[d.model_copy(deep=True) for d in data.deployments()],
        plans=[p.model_copy(deep=True) for p in data.infrastructure_plans()],
        frameworks=[f.model_copy(deep=True) for f in data.compliance_frameworks()],
        audit=[e.model_copy(deep=True) for e in data.audit_events()],
        integrations=[i.model_copy(deep=True) for i in data.integrations()],
        diagrams=[d.model_copy(deep=True) for d in data.architecture_diagrams()],
    )


_state: AppState | None = None


def get_state() -> AppState:
    global _state
    if _state is None:
        _state = _seed()
    return _state


def reset_state() -> None:
    global _state
    _state = None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def record_audit(
    state: AppState,
    *,
    actor: str,
    actor_role: Role,
    action: str,
    target: str,
    target_type: str,
    outcome: str,
    detail: str,
) -> AuditEvent:
    state.audit_counter += 1
    event = AuditEvent(
        id=f"aud-{state.audit_counter}",
        timestamp=now_iso(),
        actor=actor,
        actor_role=actor_role,
        action=action,
        target=target,
        target_type=target_type,
        outcome=outcome,
        detail=detail,
    )
    state.audit.insert(0, event)
    return event
```

- [ ] **Step 4: Point routes at the state store**

In `apps/api/src/secureflow_api/main.py`:
- Add `from . import state` to imports.
- In every existing GET route (including Task 1's), replace `data.applications()` → `state.get_state().applications`, `data.pipeline_runs()` → `state.get_state().runs`, `data.security_findings()` → `state.get_state().findings`, `data.deployments()` → `state.get_state().deployments`, `data.infrastructure_plans()` → `state.get_state().plans`, `data.compliance_frameworks()` → `state.get_state().frameworks`, `data.audit_events()` → `state.get_state().audit`, `data.integrations()` → `state.get_state().integrations`, `data.architecture_diagrams()` → `state.get_state().diagrams`. The `from . import data` import can then be removed from `main.py`.
- Rewrite the logs route to resolve the stage like the SPA mock does (accepts stage `id` or `definitionId`, returns `[]` for unknown stage):

```python
@app.get("/api/runs/{run_id}/stages/{stage_id}/logs")
async def get_stage_logs(run_id: str, stage_id: str) -> list[PipelineLogLine]:
    st = state.get_state()
    run = next((r for r in st.runs if r.id == run_id), None)
    if not run:
        raise HTTPException(status_code=404, detail="run_not_found")
    stage = next(
        (s for s in run.stages if s.id == stage_id or s.definition_id == stage_id), None
    )
    if not stage:
        return []
    return stage_logs(run, stage.definition_id)
```

- [ ] **Step 5: Update `logs.py` signature**

In `apps/api/src/secureflow_api/logs.py`, change `stage_logs` to receive the run (it currently looks it up in the immutable fixture cache, which would miss simulator updates):

```python
def stage_logs(run: PipelineRun, stage_definition_id: str) -> list[PipelineLogLine]:
    stage: PipelineStage | None = next(
        (s for s in run.stages if s.definition_id == stage_definition_id), None
    )
    if not stage or not stage.started_at:
        return []
```

Body below is unchanged. Remove the now-unused `from .data import pipeline_runs` import.

- [ ] **Step 6: Run full API test suite**

Run: `uv run --package secureflow-api pytest apps/api/tests -v`
Expected: all pass (14 + 2 new = 16). `test_stage_logs_deterministic` must still pass — it exercises the route, not the function signature.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): mutable in-memory state store with pytest reset"
```

---

### Task 3: API mutation endpoints

Port the seven mutations from `apps/web/src/lib/providers/index.ts` (mock implementations) to FastAPI. Parity notes: `approveDeployment` in the mock does **not** record an audit event — keep that; `retryStage`, `updateFindingStatus`, `promote`, `rollback` do record audit events with the exact actor/action strings below.

**Files:**
- Modify: `apps/api/src/secureflow_api/models.py` (request bodies)
- Modify: `apps/api/src/secureflow_api/main.py` (routes + CORS methods)
- Test: `apps/api/tests/test_mutations.py`

**Interfaces:**
- Consumes: `state.get_state()`, `state.record_audit(...)`, `state.now_iso()` from Task 2.
- Produces routes (all return 204 except `POST /api/audit` → 201 with the created event):
  - `POST /api/runs/{run_id}/stages/{stage_id}/retry`
  - `POST /api/runs/{run_id}/approval` — body `{decision, comment, environment}`
  - `PATCH /api/findings/{finding_id}/status` — body `{status, reason?}`
  - `POST /api/applications/{app_id}/sync`
  - `POST /api/applications/{app_id}/promote` — body `{toEnvironment}`
  - `POST /api/applications/{app_id}/rollback` — body `{revision}`
  - `POST /api/audit` — body = AuditEvent minus id/timestamp
- Task 6's HTTP providers call these with exactly these paths/bodies.

- [ ] **Step 1: Write failing tests**

Create `apps/api/tests/test_mutations.py`:

```python
from fastapi.testclient import TestClient

from secureflow_api.main import app

client = TestClient(app)


def _first_run_id() -> str:
    return client.get("/api/runs").json()[0]["id"]


def test_retry_stage_marks_stage_running_and_records_audit():
    run = client.get("/api/runs").json()[0]
    stage = run["stages"][0]
    res = client.post(f"/api/runs/{run['id']}/stages/{stage['id']}/retry")
    assert res.status_code == 204
    updated = client.get(f"/api/runs/{run['id']}").json()
    assert updated["status"] == "running"
    assert updated["stages"][0]["status"] == "running"
    assert updated["stages"][0]["finishedAt"] is None
    newest = client.get("/api/audit").json()[0]
    assert newest["action"] == "stage.retried"
    assert client.post("/api/runs/run-none/stages/x/retry").status_code == 404


def test_approval_approved_resumes_run():
    run_id = _first_run_id()
    res = client.post(
        f"/api/runs/{run_id}/approval",
        json={"decision": "approved", "comment": "smoke approval", "environment": "production"},
    )
    assert res.status_code == 204
    assert client.get(f"/api/runs/{run_id}").json()["approvalStatus"] == "approved"


def test_approval_rejected_cancels_run():
    run_id = _first_run_id()
    client.post(
        f"/api/runs/{run_id}/approval",
        json={"decision": "rejected", "comment": "not today", "environment": "production"},
    )
    run = client.get(f"/api/runs/{run_id}").json()
    assert run["approvalStatus"] == "rejected"
    assert run["status"] == "cancelled"


def test_update_finding_status_with_reason_appends_suppression():
    finding = client.get("/api/findings").json()[0]
    res = client.patch(
        f"/api/findings/{finding['id']}/status",
        json={"status": "accepted-risk", "reason": "documented business exception"},
    )
    assert res.status_code == 204
    updated = client.get(f"/api/findings/{finding['id']}").json()
    assert updated["status"] == "accepted-risk"
    assert updated["suppressionHistory"][-1]["reason"] == "documented business exception"
    assert client.get("/api/audit").json()[0]["action"] == "finding.status-changed"
    assert client.patch("/api/findings/nope/status", json={"status": "open"}).status_code == 404


def test_sync_marks_deployments_synced():
    app_id = client.get("/api/applications").json()[0]["id"]
    assert client.post(f"/api/applications/{app_id}/sync").status_code == 204
    deps = [d for d in client.get("/api/deployments").json() if d["applicationId"] == app_id]
    assert all(d["argoSyncStatus"] == "synced" for d in deps)
    assert client.post("/api/applications/nope/sync").status_code == 404


def test_promote_moves_version_forward():
    app_id = client.get("/api/applications").json()[0]["id"]
    deps = [d for d in client.get("/api/deployments").json() if d["applicationId"] == app_id]
    envs = {d["environment"] for d in deps}
    assert {"staging", "production"} <= envs, "fixture assumption: staging+production exist"
    staging = next(d for d in deps if d["environment"] == "staging")
    res = client.post(f"/api/applications/{app_id}/promote", json={"toEnvironment": "production"})
    assert res.status_code == 204
    prod = next(
        d
        for d in client.get("/api/deployments").json()
        if d["applicationId"] == app_id and d["environment"] == "production"
    )
    assert prod["version"] == staging["version"]
    assert prod["status"] == "progressing"
    assert client.get("/api/audit").json()[0]["action"] == "deployment.promoted"


def test_rollback_restores_revision():
    app_id = client.get("/api/applications").json()[0]["id"]
    res = client.post(f"/api/applications/{app_id}/rollback", json={"revision": "1.0.0-test"})
    assert res.status_code == 204
    prod = next(
        d
        for d in client.get("/api/deployments").json()
        if d["applicationId"] == app_id and d["environment"] == "production"
    )
    assert prod["version"] == "1.0.0-test"
    assert prod["status"] == "rolled-back"
    assert client.get("/api/audit").json()[0]["action"] == "deployment.rolled-back"


def test_post_audit_creates_event():
    res = client.post(
        "/api/audit",
        json={
            "actor": "You",
            "actorRole": "security-engineer",
            "action": "test.recorded",
            "target": "smoke",
            "targetType": "Test",
            "outcome": "success",
            "detail": "posted from test",
        },
    )
    assert res.status_code == 201
    assert res.json()["id"].startswith("aud-")
    assert client.get("/api/audit").json()[0]["action"] == "test.recorded"
```

Note: if the promote test's fixture assumption fails (no staging deployment for the first app), pick an application id from `apps/api/data/deployments.json` that has both `staging` and `production` rows and hardcode it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_mutations.py -v`
Expected: FAIL — 404/405 on every new route.

- [ ] **Step 3: Add request-body models**

Append to `apps/api/src/secureflow_api/models.py`:

```python
class ApprovalBody(ApiModel):
    decision: Literal["approved", "rejected", "changes-requested"]
    comment: str
    environment: EnvironmentName


class FindingStatusBody(ApiModel):
    status: FindingStatus
    reason: str | None = None


class PromoteBody(ApiModel):
    to_environment: EnvironmentName


class RollbackBody(ApiModel):
    revision: str


class AuditRecordBody(ApiModel):
    actor: str
    actor_role: Role
    action: str
    target: str
    target_type: str
    outcome: Literal["success", "denied", "failure"]
    detail: str
```

- [ ] **Step 4: Implement routes**

In `apps/api/src/secureflow_api/main.py`, extend the models import with the new body classes and `AuditEvent`, widen CORS:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("CORS_ORIGIN", "http://localhost:5173")],
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["*"],
)
```

Add the routes (helper lookups inline; ports of the mock provider logic in `apps/web/src/lib/providers/index.ts`):

```python
@app.post("/api/runs/{run_id}/stages/{stage_id}/retry", status_code=204)
async def retry_stage(run_id: str, stage_id: str) -> None:
    st = state.get_state()
    run = next((r for r in st.runs if r.id == run_id), None)
    stage = (
        next((s for s in run.stages if s.id == stage_id or s.definition_id == stage_id), None)
        if run
        else None
    )
    if not run or not stage:
        raise HTTPException(status_code=404, detail="stage_not_found")
    stage.status = "running"
    stage.failure_reason = None
    stage.started_at = state.now_iso()
    stage.finished_at = None
    run.status = "running"
    state.record_audit(
        st,
        actor="You",
        actor_role="devsecops-engineer",
        action="stage.retried",
        target=f"{run_id} / {stage.definition_id}",
        target_type="PipelineStage",
        outcome="success",
        detail=f"Manual retry of '{stage.name}'.",
    )


@app.post("/api/runs/{run_id}/approval", status_code=204)
async def approve_deployment(run_id: str, body: ApprovalBody) -> None:
    st = state.get_state()
    run = next((r for r in st.runs if r.id == run_id), None)
    if not run:
        raise HTTPException(status_code=404, detail="run_not_found")
    run.approval_status = body.decision
    if body.decision == "approved":
        run.status = "running"
        stage = next((s for s in run.stages if s.status == "waiting-approval"), None)
        if stage:
            stage.status = "succeeded"
            stage.finished_at = state.now_iso()
    else:
        run.status = "cancelled" if body.decision == "rejected" else "blocked"


@app.patch("/api/findings/{finding_id}/status", status_code=204)
async def update_finding_status(finding_id: str, body: FindingStatusBody) -> None:
    st = state.get_state()
    finding = next((f for f in st.findings if f.id == finding_id), None)
    if not finding:
        raise HTTPException(status_code=404, detail="finding_not_found")
    finding.status = body.status
    if body.reason:
        finding.suppression_history.append(
            SuppressionEntry(date=state.now_iso(), by="You", reason=body.reason)
        )
    state.record_audit(
        st,
        actor="You",
        actor_role="security-engineer",
        action="finding.status-changed",
        target=f"{finding_id} → {body.status}",
        target_type="SecurityFinding",
        outcome="success",
        detail=body.reason or "Status updated from the security command center.",
    )


@app.post("/api/applications/{app_id}/sync", status_code=204)
async def sync_application(app_id: str) -> None:
    st = state.get_state()
    if not any(a.id == app_id for a in st.applications):
        raise HTTPException(status_code=404, detail="application_not_found")
    for d in st.deployments:
        if d.application_id == app_id:
            d.argo_sync_status = "synced"


ENV_ORDER: list[EnvironmentName] = ["development", "test", "staging", "production"]


@app.post("/api/applications/{app_id}/promote", status_code=204)
async def promote(app_id: str, body: PromoteBody) -> None:
    st = state.get_state()
    if not any(a.id == app_id for a in st.applications):
        raise HTTPException(status_code=404, detail="application_not_found")
    from_index = ENV_ORDER.index(body.to_environment) - 1
    from_env = ENV_ORDER[from_index] if from_index >= 0 else None
    source = next(
        (d for d in st.deployments if d.application_id == app_id and d.environment == from_env),
        None,
    )
    target = next(
        (
            d
            for d in st.deployments
            if d.application_id == app_id and d.environment == body.to_environment
        ),
        None,
    )
    if source and target:
        target.previous_version = target.version
        target.version = source.version
        target.status = "progressing"
        target.argo_sync_status = "syncing"
        target.deployed_at = state.now_iso()
        target.deployed_by = "You (promotion)"
    state.record_audit(
        st,
        actor="You",
        actor_role="release-approver",
        action="deployment.promoted",
        target=f"{app_id} → {body.to_environment}",
        target_type="Deployment",
        outcome="success",
        detail=f"Promoted {source.version if source else 'latest'} to {body.to_environment}.",
    )


@app.post("/api/applications/{app_id}/rollback", status_code=204)
async def rollback(app_id: str, body: RollbackBody) -> None:
    st = state.get_state()
    if not any(a.id == app_id for a in st.applications):
        raise HTTPException(status_code=404, detail="application_not_found")
    prod = next(
        (
            d
            for d in st.deployments
            if d.application_id == app_id and d.environment == "production"
        ),
        None,
    )
    if prod:
        prod.previous_version = prod.version
        prod.version = body.revision
        prod.status = "rolled-back"
        prod.deployed_at = state.now_iso()
        prod.deployed_by = "You (manual rollback)"
    state.record_audit(
        st,
        actor="You",
        actor_role="release-approver",
        action="deployment.rolled-back",
        target=f"{app_id} production → {body.revision}",
        target_type="Deployment",
        outcome="success",
        detail=f"Manual rollback to {body.revision}.",
    )


@app.post("/api/audit", status_code=201)
async def record_audit_event(body: AuditRecordBody) -> AuditEvent:
    st = state.get_state()
    return state.record_audit(
        st,
        actor=body.actor,
        actor_role=body.actor_role,
        action=body.action,
        target=body.target,
        target_type=body.target_type,
        outcome=body.outcome,
        detail=body.detail,
    )
```

(`SuppressionEntry` and `EnvironmentName` are already defined in `models.py` — extend the import.)

- [ ] **Step 5: Run full API suite**

Run: `uv run --package secureflow-api pytest apps/api/tests -v`
Expected: all pass (16 + 8 = 24).

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): mutation endpoints mirroring SPA mock providers"
```

---

### Task 4: Broadcast hub + server-side simulator + typed SSE

Port `apps/web/src/lib/realtime/simulator.ts` `tick()` to Python. Read that file before implementing — the port below must stay faithful to it (constants `run-0512`, `RESET_INDEX = 11`, idle 5 ticks, stop after `smoke-tests`, image-scan finding injection, `dep-not-dev` argo sync, auto-passing `manual-approval`/`prod-approval`).

**Files:**
- Create: `apps/api/src/secureflow_api/events.py`
- Create: `apps/api/src/secureflow_api/simulator.py`
- Modify: `apps/api/src/secureflow_api/main.py` (lifespan + SSE rewrite)
- Test: `apps/api/tests/test_simulator.py`

**Interfaces:**
- Consumes: `state.AppState`, `state.get_state()`, `state.now_iso()`.
- Produces: `events.broadcast` singleton with `subscribe() -> asyncio.Queue`, `unsubscribe(queue)`, `publish(event: str, payload: dict)`; `simulator.tick(state: AppState) -> None`; `simulator.run_simulator()` async loop; SSE event names `hello`, `heartbeat`, `run-updated` (payload `{"runId": str}`), `notification` (payload `{"title": str, "body": str, "kind": str}`). Task 7's SSE client listens for exactly these names/payloads.
- Env knobs: `SIM_ENABLED` (default on; `"0"` disables — TestClient without lifespan never starts it anyway), `SIM_TICK_SECONDS` (default `7`).

- [ ] **Step 1: Write failing tests**

Create `apps/api/tests/test_simulator.py`:

```python
from secureflow_api import state
from secureflow_api.simulator import SIMULATED_RUN_ID, tick


def _run(st):
    return next(r for r in st.runs if r.id == SIMULATED_RUN_ID)


def test_tick_advances_the_running_stage():
    st = state.get_state()
    run = _run(st)
    assert run.status == "running", "fixture assumption: run-0512 ships mid-flight"
    running_idx = next(i for i, s in enumerate(run.stages) if s.status == "running")
    tick(st)
    assert run.stages[running_idx].status == "succeeded"
    assert run.stages[running_idx].finished_at is not None


def test_run_completes_and_restarts_after_idle():
    st = state.get_state()
    run = _run(st)
    for _ in range(60):  # plenty of ticks to reach completion
        tick(st)
        if run.status == "succeeded":
            break
    assert run.status == "succeeded"
    assert run.security_gate == "passed"
    assert all(s.status != "pending" for s in run.stages)
    for _ in range(5):  # idle period, then restart
        tick(st)
    assert run.status == "running"


def test_image_scan_injects_finding():
    st = state.get_state()
    run = _run(st)
    for _ in range(60):
        tick(st)
        image_scan = next(s for s in run.stages if s.definition_id == "image-scan")
        if image_scan.status == "succeeded":
            break
    assert len(image_scan.findings) == 1
    assert image_scan.findings[0].finding_id == "find-missing-limits"
```

Note: `test_run_completes_and_restarts_after_idle` assumes the module-level idle counter starts fresh; keep `_idle_ticks` reset inside `reset-state`-adjacent scope by exposing `simulator.reset()` (below) and calling it from the `conftest.py` fixture:

```python
# conftest.py fresh_state fixture becomes:
@pytest.fixture(autouse=True)
def fresh_state():
    state.reset_state()
    simulator.reset()
    yield
    state.reset_state()
    simulator.reset()
```

(add `from secureflow_api import simulator` to conftest imports).

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run --package secureflow-api pytest apps/api/tests/test_simulator.py -v`
Expected: FAIL with import error (no `simulator` module).

- [ ] **Step 3: Implement `events.py`**

```python
"""In-process pub/sub for SSE. One asyncio.Queue per subscriber.

Extension point: replace with Redis pub/sub for multi-replica fan-out.
"""

import asyncio


class Broadcast:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)

    def publish(self, event: str, payload: dict) -> None:
        for queue in self._subscribers:
            queue.put_nowait((event, payload))


broadcast = Broadcast()
```

- [ ] **Step 4: Implement `simulator.py`**

```python
"""Server-side pipeline simulator — port of apps/web/src/lib/realtime/simulator.ts.

Advances the designated demo run one stage per tick, publishing typed SSE
events so the SPA (HTTP mode) stays live. The client-side simulator remains
the memory-mode equivalent; keep the two tick implementations in sync.
"""

import asyncio
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
        tick(get_state())
```

- [ ] **Step 5: Wire lifespan + rewrite SSE in `main.py`**

Replace the `app = FastAPI(...)` construction and the `/api/events` route:

```python
from contextlib import asynccontextmanager

from .events import broadcast
from .simulator import run_simulator


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = None
    if os.environ.get("SIM_ENABLED", "1") != "0":
        task = asyncio.create_task(run_simulator())
    yield
    if task:
        task.cancel()


app = FastAPI(
    title="SecureFlow API", version="0.1.0", docs_url=None, redoc_url=None, lifespan=lifespan
)
```

```python
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
```

Existing tests use a module-level `TestClient(app)` without a context manager, so lifespan (and the simulator loop) never starts during pytest — no test interference.

- [ ] **Step 6: Run full API suite + manual SSE check**

Run: `uv run --package secureflow-api pytest apps/api/tests -v`
Expected: all pass (24 + 3 = 27).

Then boot the server and watch two tick cycles:

```bash
SIM_TICK_SECONDS=1 uv run secureflow-api &
sleep 1; curl -N --max-time 5 http://127.0.0.1:4000/api/events; kill %1
```

Expected output: `event: hello`, then `event: run-updated` lines with `{"runId": "run-0512"}` (and possibly `notification` events) within 5 seconds.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): server-side pipeline simulator with typed SSE events"
```

---

### Task 5: Shared filter/sort functions (web)

Extract the run/finding filter+sort logic from the mock providers into pure functions both mock and HTTP providers use — the HTTP provider fetches full lists and filters client-side, guaranteeing identical behavior in both modes.

**Files:**
- Create: `apps/web/src/lib/providers/filters.ts`
- Modify: `apps/web/src/lib/providers/index.ts` (use the shared functions)
- Test: `apps/web/src/lib/providers/filters.test.ts`

**Interfaces:**
- Produces: `filterAndSortRuns(runs: PipelineRun[], filters?: PipelineRunFilters): PipelineRun[]` (startedAt desc, then applicationId/status/environment/branch/search — search matches id, commit message, branch, author, sha-prefix, case-insensitive); `filterAndSortFindings(findings: SecurityFinding[], filters?: FindingFilters): SecurityFinding[]` (all 12 filter fields, severity-order sort critical→informational); `sortAuditEvents(events: AuditEvent[], limit?: number): AuditEvent[]` (timestamp desc, slice to limit, default 100). Task 6 imports all three.

- [ ] **Step 1: Write failing tests**

Create `apps/web/src/lib/providers/filters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pipelineRuns, securityFindings, auditEvents } from "@secureflow/mock-data";
import { filterAndSortFindings, filterAndSortRuns, sortAuditEvents } from "./filters";

describe("filterAndSortRuns", () => {
  it("sorts by startedAt descending", () => {
    const runs = filterAndSortRuns([...pipelineRuns]);
    for (let i = 1; i < runs.length; i++) {
      expect(new Date(runs[i - 1]!.startedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(runs[i]!.startedAt).getTime(),
      );
    }
  });

  it("filters by status and free-text search on sha prefix", () => {
    const failed = filterAndSortRuns([...pipelineRuns], { status: "failed" });
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((r) => r.status === "failed")).toBe(true);
    const target = pipelineRuns[0]!;
    const bySha = filterAndSortRuns([...pipelineRuns], { search: target.commit.sha.slice(0, 6) });
    expect(bySha.some((r) => r.id === target.id)).toBe(true);
  });
});

describe("filterAndSortFindings", () => {
  it("sorts by severity order", () => {
    const order = { critical: 0, high: 1, medium: 2, low: 3, informational: 4 };
    const findings = filterAndSortFindings([...securityFindings]);
    for (let i = 1; i < findings.length; i++) {
      expect(order[findings[i - 1]!.severity]).toBeLessThanOrEqual(order[findings[i]!.severity]);
    }
  });

  it("filters by frameworkId via compliance mappings", () => {
    const owasp = filterAndSortFindings([...securityFindings], { frameworkId: "owasp-top-10" });
    expect(owasp.length).toBeGreaterThan(0);
    expect(
      owasp.every((f) => f.complianceMappings.some((m) => m.frameworkId === "owasp-top-10")),
    ).toBe(true);
  });
});

describe("sortAuditEvents", () => {
  it("sorts descending and respects limit", () => {
    const events = sortAuditEvents([...auditEvents], 3);
    expect(events).toHaveLength(3);
    expect(new Date(events[0]!.timestamp).getTime()).toBeGreaterThanOrEqual(
      new Date(events[1]!.timestamp).getTime(),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @secureflow/web test`
Expected: new file FAILS (module `./filters` not found); existing 28 pass.

- [ ] **Step 3: Implement `filters.ts`**

Move the filter/sort bodies verbatim from `listRuns`, `listFindings`, and `listEvents` in `apps/web/src/lib/providers/index.ts` into:

```ts
import type {
  AuditEvent,
  FindingFilters,
  PipelineRun,
  PipelineRunFilters,
  SecurityFinding,
} from "@secureflow/types";

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, informational: 4 } as const;

export function filterAndSortRuns(
  runs: PipelineRun[],
  filters?: PipelineRunFilters,
): PipelineRun[] {
  let result = [...runs].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
  if (filters?.applicationId) result = result.filter((r) => r.applicationId === filters.applicationId);
  if (filters?.status) result = result.filter((r) => r.status === filters.status);
  if (filters?.environment) result = result.filter((r) => r.environment === filters.environment);
  if (filters?.branch) result = result.filter((r) => r.commit.branch === filters.branch);
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.commit.message.toLowerCase().includes(q) ||
        r.commit.branch.toLowerCase().includes(q) ||
        r.commit.author.toLowerCase().includes(q) ||
        r.commit.sha.startsWith(q),
    );
  }
  return result;
}

export function filterAndSortFindings(
  findings: SecurityFinding[],
  filters?: FindingFilters,
): SecurityFinding[] {
  let result = [...findings];
  if (filters?.applicationId) result = result.filter((f) => f.applicationId === filters.applicationId);
  if (filters?.repositoryId) result = result.filter((f) => f.repositoryId === filters.repositoryId);
  if (filters?.branch) result = result.filter((f) => f.branch === filters.branch);
  if (filters?.environment) result = result.filter((f) => f.environment === filters.environment);
  if (filters?.scanner) result = result.filter((f) => f.scanner === filters.scanner);
  if (filters?.type) result = result.filter((f) => f.type === filters.type);
  if (filters?.severity) result = result.filter((f) => f.severity === filters.severity);
  if (filters?.status) result = result.filter((f) => f.status === filters.status);
  if (filters?.ownerUserId) result = result.filter((f) => f.ownerUserId === filters.ownerUserId);
  if (filters?.pipelineRunId) result = result.filter((f) => f.pipelineRunId === filters.pipelineRunId);
  if (filters?.frameworkId)
    result = result.filter((f) =>
      f.complianceMappings.some((m) => m.frameworkId === filters.frameworkId),
    );
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (f) =>
        f.title.toLowerCase().includes(q) ||
        f.ruleId.toLowerCase().includes(q) ||
        (f.cve ?? "").toLowerCase().includes(q) ||
        f.affectedResource.toLowerCase().includes(q),
    );
  }
  return result.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function sortAuditEvents(events: AuditEvent[], limit = 100): AuditEvent[] {
  return [...events]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}
```

Then in `apps/web/src/lib/providers/index.ts` add
`import { filterAndSortFindings, filterAndSortRuns, sortAuditEvents } from "./filters";`
and replace the inlined logic:
- `listRuns`: `return delay(filterAndSortRuns(mockState.runs, filters));`
- `listFindings`: `return delay(filterAndSortFindings(mockState.findings, filters));`
- `listEvents`: `return delay(sortAuditEvents(mockState.audit, limit));`

(`auditEvents` must be exported from `@secureflow/mock-data` — it already is; see `packages/mock-data/src/operations.ts`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @secureflow/web test`
Expected: all pass (28 + 5 = 33).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/providers
git commit -m "refactor(web): extract shared provider filter/sort functions"
```

---

### Task 6: HTTP providers + factory + Vite proxy

**Files:**
- Rename: `apps/web/src/lib/providers/index.ts` → `apps/web/src/lib/providers/mock.ts`
- Create: `apps/web/src/lib/providers/http.ts`
- Create: `apps/web/src/lib/providers/index.ts` (factory)
- Modify: `apps/web/vite.config.ts` (proxy + vitest env)
- Test: `apps/web/src/lib/providers/http.test.ts`

**Interfaces:**
- Consumes: Task 5 filters; Task 1–3 API routes.
- Produces: `dataSource: "http" | "memory"` export from `@/lib/providers` (Task 7 uses it); same eight named provider exports (`pipelineProvider`, `securityProvider`, `deploymentProvider`, `infrastructureProvider`, `complianceProvider`, `architectureProvider`, `auditProvider`, `integrationProvider`) plus the existing `export { mockState } from "./mock-state"` re-export, so no consumer import changes.

- [ ] **Step 1: Rename mock module**

```bash
git mv apps/web/src/lib/providers/index.ts apps/web/src/lib/providers/mock.ts
```

Remove the line `export { mockState } from "./mock-state";` from `mock.ts` (the factory re-exports it instead).

- [ ] **Step 2: Write failing tests**

Create `apps/web/src/lib/providers/http.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pipelineRuns } from "@secureflow/mock-data";
import * as http from "./http";

const okJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("http providers", () => {
  it("listRuns fetches /api/runs and applies filters client-side", async () => {
    fetchMock.mockResolvedValue(okJson(pipelineRuns));
    const failed = await http.pipelineProvider.listRuns({ status: "failed" });
    expect(fetchMock).toHaveBeenCalledWith("/api/runs", expect.anything());
    expect(failed.every((r) => r.status === "failed")).toBe(true);
  });

  it("retryStage POSTs to the retry route and resolves on 204", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await http.pipelineProvider.retryStage("run-0001", "stage-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-0001/stages/stage-1/retry",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("updateFindingStatus PATCHes a JSON body", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await http.securityProvider.updateFindingStatus("find-1", "accepted-risk", "because");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/findings/find-1/status");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ status: "accepted-risk", reason: "because" });
  });

  it("surfaces the API detail message on error responses", async () => {
    fetchMock.mockResolvedValue(okJson({ detail: "run_not_found" }, 404));
    await expect(http.pipelineProvider.getRun("run-none")).rejects.toThrow(/run_not_found/);
  });

  it("promote sends camelCase body to the promote route", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await http.deploymentProvider.promote("app-1", "production");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/applications/app-1/promote");
    expect(JSON.parse(init.body as string)).toEqual({ toEnvironment: "production" });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @secureflow/web test`
Expected: `http.test.ts` FAILS (no `./http` module). Some other suites may fail on the missing `providers/index.ts` — that resolves in Step 5.

- [ ] **Step 4: Implement `http.ts`**

```ts
import type {
  ApprovalRequest,
  ArchitectureDiagram,
  ArchitectureProvider,
  Application,
  AuditEvent,
  AuditProvider,
  ComplianceFramework,
  ComplianceProvider,
  Deployment,
  DeploymentProvider,
  EnvironmentName,
  FindingFilters,
  FindingStatus,
  InfrastructurePlan,
  InfrastructureProvider,
  Integration,
  IntegrationProvider,
  PipelineLogLine,
  PipelineProvider,
  PipelineRun,
  PipelineRunFilters,
  SecurityFinding,
  SecurityProvider,
} from "@secureflow/types";
import { filterAndSortFindings, filterAndSortRuns, sortAuditEvents } from "./filters";

/**
 * HTTP provider implementations. Same-origin `/api/*` paths — the Vite dev
 * server proxies them to the FastAPI process (see vite.config.ts); in
 * production the SPA and API sit behind the same origin.
 *
 * List endpoints return the full dataset; filtering/sorting happens client-side
 * via the same shared functions the mock providers use, so both modes behave
 * identically.
 */

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // non-JSON error body; keep the status text
    }
    throw new Error(`API request failed: ${detail}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const post = (path: string, body?: unknown) =>
  api<void>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const pipelineProvider: PipelineProvider = {
  async listRuns(filters?: PipelineRunFilters) {
    return filterAndSortRuns(await api<PipelineRun[]>("/api/runs"), filters);
  },
  getRun: (runId) => api<PipelineRun>(`/api/runs/${runId}`),
  getStageLogs: (runId, stageId) =>
    api<PipelineLogLine[]>(`/api/runs/${runId}/stages/${stageId}/logs`),
  retryStage: (runId, stageId) => post(`/api/runs/${runId}/stages/${stageId}/retry`),
  approveDeployment: (runId, approval: ApprovalRequest) =>
    post(`/api/runs/${runId}/approval`, approval),
};

export const securityProvider: SecurityProvider = {
  async listFindings(filters?: FindingFilters) {
    return filterAndSortFindings(await api<SecurityFinding[]>("/api/findings"), filters);
  },
  getFinding: (findingId) => api<SecurityFinding>(`/api/findings/${findingId}`),
  updateFindingStatus: (findingId: string, status: FindingStatus, reason?: string) =>
    api<void>(`/api/findings/${findingId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, reason }),
    }),
};

export const deploymentProvider: DeploymentProvider = {
  listApplications: () => api<Application[]>("/api/applications"),
  getApplication: (applicationId) => api<Application>(`/api/applications/${applicationId}`),
  async listDeployments(applicationId?: string) {
    const deployments = await api<Deployment[]>("/api/deployments");
    return applicationId
      ? deployments.filter((d) => d.applicationId === applicationId)
      : deployments;
  },
  syncApplication: (applicationId) => post(`/api/applications/${applicationId}/sync`),
  promote: (applicationId, toEnvironment: EnvironmentName) =>
    post(`/api/applications/${applicationId}/promote`, { toEnvironment }),
  rollback: (applicationId, revision: string) =>
    post(`/api/applications/${applicationId}/rollback`, { revision }),
};

export const infrastructureProvider: InfrastructureProvider = {
  async listPlans(applicationId?: string) {
    const plans = await api<InfrastructurePlan[]>("/api/plans");
    return applicationId ? plans.filter((p) => p.applicationId === applicationId) : plans;
  },
  getPlan: (planId) => api<InfrastructurePlan>(`/api/plans/${planId}`),
};

export const complianceProvider: ComplianceProvider = {
  listFrameworks: () => api<ComplianceFramework[]>("/api/frameworks"),
  getFramework: (frameworkId) => api<ComplianceFramework>(`/api/frameworks/${frameworkId}`),
};

export const architectureProvider: ArchitectureProvider = {
  getDiagram: (applicationId) => api<ArchitectureDiagram>(`/api/architecture/${applicationId}`),
};

export const auditProvider: AuditProvider = {
  async listEvents(limit = 100) {
    return sortAuditEvents(await api<AuditEvent[]>("/api/audit"), limit);
  },
  record: (event) => post("/api/audit", event),
};

export const integrationProvider: IntegrationProvider = {
  listIntegrations: () => api<Integration[]>("/api/integrations"),
};
```

- [ ] **Step 5: Implement the factory `index.ts`**

Create the new `apps/web/src/lib/providers/index.ts`:

```ts
import * as httpProviders from "./http";
import * as mockProviders from "./mock";

/**
 * Provider factory. VITE_DATA_SOURCE=memory selects the in-memory mock
 * implementations (vitest + the memory-mode Playwright project); anything
 * else — including unset — selects HTTP against the FastAPI backend.
 */
export type DataSource = "http" | "memory";

export const dataSource: DataSource =
  import.meta.env.VITE_DATA_SOURCE === "memory" ? "memory" : "http";

const impl = dataSource === "memory" ? mockProviders : httpProviders;

export const pipelineProvider = impl.pipelineProvider;
export const securityProvider = impl.securityProvider;
export const deploymentProvider = impl.deploymentProvider;
export const infrastructureProvider = impl.infrastructureProvider;
export const complianceProvider = impl.complianceProvider;
export const architectureProvider = impl.architectureProvider;
export const auditProvider = impl.auditProvider;
export const integrationProvider = impl.integrationProvider;

export { mockState } from "./mock-state";
```

Check for any other imports of the old module shape before moving on:

```bash
grep -rn 'from "@/lib/providers"' apps/web/src | grep -v providers/
```

Every hit must only use the names exported above.

Add a factory mode-selection test at the bottom of `apps/web/src/lib/providers/http.test.ts` (vitest pins `VITE_DATA_SOURCE=memory`, so the factory must resolve to the mock implementations):

```ts
describe("provider factory", () => {
  it("selects mock providers when VITE_DATA_SOURCE=memory", async () => {
    const factory = await import("./index");
    const mock = await import("./mock");
    expect(factory.dataSource).toBe("memory");
    expect(factory.pipelineProvider).toBe(mock.pipelineProvider);
  });
});
```

- [ ] **Step 6: Vite proxy + vitest env**

In `apps/web/vite.config.ts`:

```ts
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:4000", changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    env: { VITE_DATA_SOURCE: "memory" },
  },
```

- [ ] **Step 7: Run gates**

Run: `pnpm --filter @secureflow/web test && pnpm lint && pnpm typecheck`
Expected: all vitest pass (33 + 6 = 39; the 28 pre-existing tests run against mock providers because of the vitest env); lint + typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/providers apps/web/vite.config.ts
git commit -m "feat(web): HTTP providers behind VITE_DATA_SOURCE factory"
```

---

### Task 7: SSE client + App wiring

**Files:**
- Create: `apps/web/src/lib/realtime/sse-client.ts`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/lib/realtime/sse-client.test.ts`

**Interfaces:**
- Consumes: `dataSource` from `@/lib/providers` (Task 6); SSE event names/payloads from Task 4 (`run-updated` → `{runId}`, `notification` → `{title, body, kind}`).
- Produces: `startEventStream(queryClient: QueryClient): () => void`, plus exported-for-test `handleRunUpdated(queryClient, payload)` and `handleNotification(queryClient, n)`.

- [ ] **Step 1: Write failing tests**

jsdom has no `EventSource`, so tests target the exported handlers. Create `apps/web/src/lib/realtime/sse-client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { useNotifications } from "@/stores/notifications";
import { handleNotification, handleRunUpdated } from "./sse-client";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

describe("sse-client handlers", () => {
  it("run-updated invalidates run-related query keys", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    handleRunUpdated(qc, { runId: "run-0512" });
    const keys = spy.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
    expect(keys).toContain(JSON.stringify(["runs"]));
    expect(keys).toContain(JSON.stringify(["run", "run-0512"]));
    expect(keys).toContain(JSON.stringify(["deployments"]));
  });

  it("notification pushes to the notifications store", () => {
    const qc = new QueryClient();
    const before = useNotifications.getState().items.length;
    handleNotification(qc, { title: "Pipeline started", body: "demo", kind: "info" });
    expect(useNotifications.getState().items.length).toBe(before + 1);
  });
});
```

Note: check `apps/web/src/stores/notifications.ts` for the actual store shape — if the list field is not named `items`, adjust the assertion to the real field name (the store already exists and is used by `simulator.ts` via `useNotifications.getState().push(n)`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @secureflow/web test`
Expected: FAIL — no `./sse-client` module.

- [ ] **Step 3: Implement `sse-client.ts`**

```ts
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNotifications } from "@/stores/notifications";

export interface NotificationEvent {
  title: string;
  body: string;
  kind: "info" | "success" | "warning" | "error";
}

/**
 * HTTP-mode realtime: subscribes to the API's SSE stream and pushes updates
 * through the same TanStack Query invalidation + notification paths the
 * memory-mode simulator uses.
 */
export function startEventStream(queryClient: QueryClient): () => void {
  const source = new EventSource("/api/events");
  source.addEventListener("run-updated", (event) => {
    handleRunUpdated(queryClient, JSON.parse((event as MessageEvent).data));
  });
  source.addEventListener("notification", (event) => {
    handleNotification(queryClient, JSON.parse((event as MessageEvent).data));
  });
  return () => source.close();
}

export function handleRunUpdated(queryClient: QueryClient, payload: { runId: string }): void {
  void queryClient.invalidateQueries({ queryKey: ["runs"] });
  void queryClient.invalidateQueries({ queryKey: ["run", payload.runId] });
  void queryClient.invalidateQueries({ queryKey: ["deployments"] });
  void queryClient.invalidateQueries({ queryKey: ["applications"] });
}

export function handleNotification(queryClient: QueryClient, n: NotificationEvent): void {
  useNotifications.getState().push(n);
  const fn =
    n.kind === "success"
      ? toast.success
      : n.kind === "warning"
        ? toast.warning
        : n.kind === "error"
          ? toast.error
          : toast.info;
  fn(n.title, { description: n.body });
  void queryClient.invalidateQueries({ queryKey: ["audit"] });
}
```

- [ ] **Step 4: Wire `App.tsx`**

```ts
import { dataSource } from "@/lib/providers";
import { startPipelineSimulator } from "@/lib/realtime/simulator";
import { startEventStream } from "@/lib/realtime/sse-client";
```

and replace the effect:

```ts
  useEffect(
    () =>
      dataSource === "memory"
        ? startPipelineSimulator(queryClient)
        : startEventStream(queryClient),
    [],
  );
```

- [ ] **Step 5: Run gates**

Run: `pnpm --filter @secureflow/web test && pnpm lint && pnpm typecheck && pnpm --filter @secureflow/web build`
Expected: all green (39 + 2 = 41 vitest).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/realtime apps/web/src/App.tsx
git commit -m "feat(web): SSE event stream client for HTTP mode"
```

---

### Task 8: Playwright http-smoke project, CI, docs, full verification

**Files:**
- Modify: `apps/web/playwright.config.ts` (pin memory mode)
- Create: `apps/web/playwright.http.config.ts`
- Create: `apps/web/e2e-http/http-smoke.spec.ts`
- Modify: `apps/web/package.json` (`e2e:http` script)
- Modify: `package.json` (root `e2e:http` script)
- Modify: `.github/workflows/ci.yml` (new job)
- Modify: `docs/local-development.md`, `README.md` (modes documentation)

**Interfaces:**
- Consumes: everything above; `uv run secureflow-api` entry point (defined in `apps/api/pyproject.toml`).
- Produces: `pnpm e2e:http` runs the smoke suite; CI job `e2e-http`.

- [ ] **Step 1: Pin the existing e2e project to memory mode**

In `apps/web/playwright.config.ts`, extend `webServer`:

```ts
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
    env: { VITE_DATA_SOURCE: "memory" },
  },
```

Run: `pnpm --filter @secureflow/web e2e`
Expected: existing 10 e2e pass (unchanged behavior — memory mode is what they always exercised).

- [ ] **Step 2: Create `playwright.http.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

/**
 * HTTP-mode smoke suite: boots the FastAPI backend (uv) and the web dev
 * server with VITE_DATA_SOURCE=http, then verifies real round-trips.
 * Run: pnpm e2e:http (repo root) — stop any memory-mode dev server first,
 * the web entry refuses to reuse a server whose mode it can't verify.
 */
export default defineConfig({
  testDir: "./e2e-http",
  timeout: 45_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "uv run secureflow-api",
      cwd: "../..",
      url: "http://127.0.0.1:4000/health",
      reuseExistingServer: true,
      timeout: 60_000,
      env: { SIM_TICK_SECONDS: "2" },
    },
    {
      command: "pnpm dev",
      url: "http://localhost:5173",
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_DATA_SOURCE: "http" },
    },
  ],
});
```

- [ ] **Step 3: Write the smoke spec**

Create `apps/web/e2e-http/http-smoke.spec.ts`. Before writing assertions on page content, open `apps/web/e2e/critical-journeys.spec.ts` and reuse its overview/pipelines selectors so the smoke spec matches the real UI.

```ts
import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:4000";

test("overview renders with data fetched from the API", async ({ page }) => {
  const applications = page.waitForResponse(
    (r) => r.url().includes("/api/applications") && r.status() === 200,
  );
  await page.goto("/");
  await applications;
  // Reuse the overview heading/tile assertion from e2e/critical-journeys.spec.ts here.
  await expect(page.getByRole("heading").first()).toBeVisible();
});

test("pipelines list shows runs served by the API", async ({ page }) => {
  const runsResponse = page.waitForResponse(
    (r) =>
      r.url().includes("/api/runs") && !r.url().includes("/stages/") && r.status() === 200,
  );
  await page.goto("/pipelines");
  const runs = (await (await runsResponse).json()) as { commit: { message: string } }[];
  expect(runs.length).toBeGreaterThan(0);
  // Adjust the visible-field assertion to whatever the pipelines table renders
  // (check e2e/critical-journeys.spec.ts) — commit message is the default guess.
  await expect(page.getByText(runs[0]!.commit.message).first()).toBeVisible();
});

test("finding status mutation round-trips through the API", async ({ request }) => {
  const findings = (await (await request.get(`${API}/api/findings`)).json()) as {
    id: string;
    status: string;
  }[];
  const target = findings.find((f) => f.status === "open");
  expect(target).toBeDefined();
  const patch = await request.patch(`${API}/api/findings/${target!.id}/status`, {
    data: { status: "in-remediation", reason: "http-smoke round-trip" },
  });
  expect(patch.status()).toBe(204);
  const after = (await (await request.get(`${API}/api/findings/${target!.id}`)).json()) as {
    status: string;
  };
  expect(after.status).toBe("in-remediation");
});
```

- [ ] **Step 4: Add scripts**

`apps/web/package.json` scripts: add `"e2e:http": "playwright test -c playwright.http.config.ts"`.
Root `package.json` scripts: add `"e2e:http": "pnpm --filter @secureflow/web e2e:http"`.

- [ ] **Step 5: Run the smoke suite locally**

```bash
pnpm e2e:http
```

Expected: 3 passed. If the pipelines-table assertion fails, fix the selector against the real UI (screenshot/trace will show the table contents) — the network assertions must stay.

- [ ] **Step 6: Add the CI job**

In `.github/workflows/ci.yml`, add after the `quality` job:

```yaml
  e2e-http:
    name: HTTP-mode smoke (Playwright)
    needs: quality
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Set up uv
        uses: astral-sh/setup-uv@v6
        with:
          enable-cache: true
      - name: API dependencies (uv, locked)
        run: uv sync --locked --all-packages
      - name: Install Playwright browsers
        run: pnpm --filter @secureflow/web exec playwright install --with-deps chromium
      - name: HTTP-mode smoke suite
        run: pnpm e2e:http
```

- [ ] **Step 7: Update docs**

`docs/local-development.md` — add a "Data modes" section:

```markdown
## Data modes

The SPA reads `VITE_DATA_SOURCE` at build/dev time:

- **`http` (default):** providers call the FastAPI backend at `/api/*` (the
  Vite dev server proxies to `http://127.0.0.1:4000`). Realtime comes from
  the server's SSE stream (`/api/events`) — start both processes:

      pnpm dev:api   # FastAPI on :4000 (server-side simulator on)
      pnpm dev       # Vite on :5173

- **`memory`:** providers run fully in-browser against the mock dataset;
  the client-side simulator drives realtime. No API process needed:

      VITE_DATA_SOURCE=memory pnpm dev

vitest and the default Playwright suite pin `memory`; `pnpm e2e:http` boots
both servers and smoke-tests the HTTP path.
```

`README.md` — update the Environment variables paragraph (it currently says the `VITE_*` entries "are not read yet"): `VITE_DATA_SOURCE` now selects the provider mode (`http` default, `memory` for in-browser mocks). Also check `.env.example` — if it stubs `VITE_DATA_SOURCE`, align the comment.

- [ ] **Step 8: Full gate run**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:api && pnpm e2e && pnpm e2e:http && pnpm --filter @secureflow/web build
```

Expected: everything green (41 vitest, 27 pytest, 10 memory e2e, 3 http-smoke e2e).

Then a manual browser check: with `pnpm dev:api` + `pnpm dev` running, load `http://localhost:5173`, confirm the overview shows data, watch the pipeline run advance within ~15s (SSE), and check the console for errors.

- [ ] **Step 9: Commit**

```bash
git add apps/web .github/workflows/ci.yml docs/local-development.md README.md .env.example package.json
git commit -m "feat: http-smoke e2e project, CI job, and data-mode docs"
```
