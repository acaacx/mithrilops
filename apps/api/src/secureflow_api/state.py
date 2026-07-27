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
