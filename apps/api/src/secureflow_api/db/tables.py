"""Hybrid storage schema: payload JSONB is the source of truth; typed columns
exist only for WHERE/ORDER BY and are re-derived from the payload on every
write (see repositories.py). `seq` is an identity column preserving fixture
insertion order — the list-endpoint ordering contract.
"""

from sqlalchemy import BigInteger, Column, Identity, MetaData, Sequence, Table, Text
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP

metadata = MetaData()

# Runtime audit ids continue after the aud-1..aud-10 fixture range.
audit_id_seq = Sequence("audit_id_seq", start=101, metadata=metadata)


def _entity_table(name: str, *extra: Column) -> Table:
    return Table(
        name,
        metadata,
        Column("id", Text, primary_key=True),
        Column("seq", BigInteger, Identity(always=True), nullable=False, unique=True),
        Column("payload", JSONB, nullable=False),
        *extra,
    )


applications = _entity_table("applications")
runs = _entity_table(
    "runs",
    Column("application_id", Text, nullable=False, index=True),
    Column("status", Text, nullable=False),
    Column("environment", Text, nullable=False),
    Column("started_at", TIMESTAMP(timezone=True), nullable=False, index=True),
)
approvals = _entity_table(
    "approvals",
    Column("run_id", Text, nullable=False, index=True),
    Column("decision", Text, nullable=False),
)
findings = _entity_table(
    "findings",
    Column("application_id", Text, nullable=False, index=True),
    Column("severity", Text, nullable=False),
    Column("status", Text, nullable=False),
)
deployments = _entity_table(
    "deployments",
    Column("application_id", Text, nullable=False, index=True),
    Column("environment", Text, nullable=False),
    Column("status", Text, nullable=False),
)
plans = _entity_table("plans", Column("application_id", Text, nullable=False, index=True))
frameworks = _entity_table("frameworks")
audit = _entity_table(
    "audit",
    Column("timestamp", TIMESTAMP(timezone=True), nullable=False, index=True),
    Column("actor", Text, nullable=False),
    Column("target_type", Text, nullable=False),
)
integrations = _entity_table("integrations")
diagrams = _entity_table("diagrams", Column("application_id", Text, nullable=False, index=True))

# Seed guard: one row means "this database has been seeded" — deliberately not
# a row count, so a demo where every run was deleted does not silently reseed.
demo_seed = Table(
    "demo_seed",
    metadata,
    Column("seeded_at", TIMESTAMP(timezone=True), primary_key=True),
)

ENTITY_TABLES: dict[str, Table] = {
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
