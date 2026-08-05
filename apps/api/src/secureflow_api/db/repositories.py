# apps/api/src/secureflow_api/db/repositories.py
"""One repository per entity. Reads deserialize payload back into the Pydantic
model — typed columns are for WHERE/ORDER BY, never for reconstructing the
object. save() writes payload and re-derives every typed column in the same
statement, so drift is structurally impossible.
"""

from collections.abc import Callable
from datetime import datetime

from sqlalchemy import Table, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..clock import now_iso
from ..models import (
    ApiModel,
    Application,
    Approval,
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
from . import tables


def parse_ts(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


class Repo[M: ApiModel]:
    def __init__(
        self,
        table: Table,
        model: type[M],
        derive: Callable[[M], dict[str, object]] = lambda m: {},
    ) -> None:
        self.table = table
        self.model = model
        self.derive = derive

    def _order(self):
        return (self.table.c.seq.asc(),)

    async def list(self, session: AsyncSession, **filters: object) -> list[M]:
        stmt = select(self.table.c.payload).order_by(*self._order())
        for col, val in filters.items():
            if val is not None:
                stmt = stmt.where(self.table.c[col] == val)
        rows = await session.execute(stmt)
        return [self.model.model_validate(payload) for (payload,) in rows]

    async def get(self, session: AsyncSession, id: str, *, for_update: bool = False) -> M | None:
        stmt = select(self.table.c.payload).where(self.table.c.id == id)
        if for_update:
            stmt = stmt.with_for_update()
        payload = (await session.execute(stmt)).scalar_one_or_none()
        return None if payload is None else self.model.model_validate(payload)

    async def save(self, session: AsyncSession, obj: M) -> None:
        payload = obj.model_dump(mode="json", by_alias=True)
        values: dict[str, object] = {"id": obj.id, "payload": payload, **self.derive(obj)}
        stmt = insert(self.table).values(**values)
        stmt = stmt.on_conflict_do_update(
            index_elements=["id"],
            set_={k: v for k, v in values.items() if k != "id"},
        )
        await session.execute(stmt)


class AuditRepo(Repo[AuditEvent]):
    def _order(self):
        return (self.table.c["timestamp"].desc(), self.table.c.seq.desc())

    async def record(
        self,
        session: AsyncSession,
        *,
        actor: str,
        actor_role: Role,
        action: str,
        target: str,
        target_type: str,
        outcome: str,
        detail: str,
    ) -> AuditEvent:
        n = (await session.execute(text("SELECT nextval('audit_id_seq')"))).scalar_one()
        event = AuditEvent(
            id=f"aud-{n}",
            timestamp=now_iso(),
            actor=actor,
            actor_role=actor_role,
            action=action,
            target=target,
            target_type=target_type,
            outcome=outcome,
            detail=detail,
        )
        await self.save(session, event)
        return event


applications = Repo(tables.applications, Application)
runs = Repo(
    tables.runs,
    PipelineRun,
    lambda r: {
        "application_id": r.application_id,
        "status": r.status,
        "environment": r.environment,
        "started_at": parse_ts(r.started_at),
    },
)
approvals = Repo(
    tables.approvals, Approval, lambda a: {"run_id": a.run_id, "decision": a.decision}
)
findings = Repo(
    tables.findings,
    SecurityFinding,
    lambda f: {"application_id": f.application_id, "severity": f.severity, "status": f.status},
)
deployments = Repo(
    tables.deployments,
    Deployment,
    lambda d: {
        "application_id": d.application_id,
        "environment": d.environment,
        "status": d.status,
    },
)
plans = Repo(tables.plans, InfrastructurePlan, lambda p: {"application_id": p.application_id})
frameworks = Repo(tables.frameworks, ComplianceFramework)
audit = AuditRepo(
    tables.audit,
    AuditEvent,
    lambda e: {"timestamp": parse_ts(e.timestamp), "actor": e.actor, "target_type": e.target_type},
)
integrations = Repo(tables.integrations, Integration)
diagrams = Repo(
    tables.diagrams, ArchitectureDiagram, lambda d: {"application_id": d.application_id}
)

ALL: dict[str, Repo] = {
    "applications": applications,
    "runs": runs,
    "approvals": approvals,
    "findings": findings,
    "deployments": deployments,
    "plans": plans,
    "frameworks": frameworks,
    "audit": audit,
    "integrations": integrations,
    "diagrams": diagrams,
}
