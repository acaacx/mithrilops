"""Fixture loading. The JSON files in apps/api/data are exported from the
@secureflow/mock-data package (single source of truth shared with the SPA) and
validated against the Pydantic models at load time.

Extension point: replace with PostgreSQL + SQLAlchemy repositories.
"""

import json
from functools import cache
from pathlib import Path

from pydantic import TypeAdapter

from .models import (
    Application,
    AuditEvent,
    ComplianceFramework,
    Deployment,
    InfrastructurePlan,
    PipelineRun,
    SecurityFinding,
)

DATA_DIR = Path(__file__).resolve().parents[2] / "data"


def _load[T](name: str, adapter: TypeAdapter[list[T]]) -> list[T]:
    raw = json.loads((DATA_DIR / f"{name}.json").read_text())
    return adapter.validate_python(raw)


@cache
def applications() -> list[Application]:
    return _load("applications", TypeAdapter(list[Application]))


@cache
def pipeline_runs() -> list[PipelineRun]:
    return _load("runs", TypeAdapter(list[PipelineRun]))


@cache
def security_findings() -> list[SecurityFinding]:
    return _load("findings", TypeAdapter(list[SecurityFinding]))


@cache
def deployments() -> list[Deployment]:
    return _load("deployments", TypeAdapter(list[Deployment]))


@cache
def infrastructure_plans() -> list[InfrastructurePlan]:
    return _load("plans", TypeAdapter(list[InfrastructurePlan]))


@cache
def compliance_frameworks() -> list[ComplianceFramework]:
    return _load("frameworks", TypeAdapter(list[ComplianceFramework]))


@cache
def audit_events() -> list[AuditEvent]:
    return _load("audit", TypeAdapter(list[AuditEvent]))
