"""Pydantic models mirroring @secureflow/types entities served by the API.

Field names are snake_case in Python; JSON stays camelCase (the contract the
SPA already consumes) via the alias generator.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

Role = Literal[
    "developer",
    "devsecops-engineer",
    "security-engineer",
    "platform-engineer",
    "application-owner",
    "compliance-reviewer",
    "release-approver",
    "administrator",
]
EnvironmentName = Literal["development", "test", "staging", "production"]
PipelineRunStatus = Literal[
    "succeeded",
    "running",
    "failed",
    "blocked",
    "waiting-approval",
    "rolled-back",
    "cancelled",
]
StageStatus = Literal[
    "pending",
    "running",
    "succeeded",
    "failed",
    "skipped",
    "blocked",
    "waiting-approval",
]
Severity = Literal["critical", "high", "medium", "low", "informational"]
FindingStatus = Literal[
    "open", "in-remediation", "accepted-risk", "false-positive", "resolved"
]
FindingType = Literal[
    "vulnerability",
    "misconfiguration",
    "secret",
    "iam",
    "container",
    "iac",
    "dependency",
    "code-quality",
    "runtime",
    "dast",
]
Scanner = Literal[
    "gitleaks",
    "snyk",
    "sonarqube",
    "checkov",
    "tfsec",
    "trivy",
    "owasp-zap",
    "defender-for-cloud",
    "syft",
    "cosign",
    "kube-bench",
]
FrameworkId = Literal[
    "owasp-top-10",
    "cis-benchmarks",
    "nist-csf",
    "iso-27001",
    "soc-2",
    "pci-dss",
    "azure-security-benchmark",
]
ControlStatus = Literal["passed", "failed", "needs-evidence", "exception", "not-applicable"]
DeploymentStrategy = Literal["rolling", "canary", "blue-green", "recreate"]
DeploymentStatus = Literal["healthy", "degraded", "progressing", "failed", "rolled-back"]
ArgoSyncStatus = Literal["synced", "out-of-sync", "syncing", "unknown"]
DriftStatus = Literal["in-sync", "drift-detected", "unknown"]
ApprovalDecision = Literal["approved", "rejected", "changes-requested", "pending"]
RiskLevel = Literal["critical", "high", "medium", "low"]
TriggerType = Literal["push", "pull-request", "manual", "schedule", "rollback"]
LogLevel = Literal["info", "warn", "error", "debug"]
StagePhase = Literal["ci", "security", "artifact", "infrastructure", "deploy", "verify"]


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
    )


class SLO(ApiModel):
    metric: Literal["availability", "latency-p95", "error-rate"]
    target: str
    current: str
    status: Literal["met", "at-risk", "breached"]


class OpenVulnerabilities(ApiModel):
    critical: int
    high: int
    medium: int
    low: int


class Application(ApiModel):
    id: str
    name: str
    slug: str
    description: str
    owner_user_id: str
    team_id: str
    repository_id: str
    technology: list[str]
    cloud_environment: str
    current_version: str
    deployment_status: DeploymentStatus
    pipeline_health: Literal["healthy", "unstable", "failing"]
    security_score: int
    compliance_score: int
    last_deployment_at: str
    open_vulnerabilities: OpenVulnerabilities
    availability: str
    risk_level: RiskLevel
    slos: list[SLO]
    argo_app_name: str
    error_rate: str
    latency_p95: str


class StageFindingRef(ApiModel):
    finding_id: str
    severity: Severity
    title: str


class PipelineStage(ApiModel):
    id: str
    definition_id: str
    name: str
    tool: str
    phase: StagePhase
    status: StageStatus
    started_at: str | None = None
    finished_at: str | None = None
    duration_seconds: int | None = None
    owner: str
    blocks_deployment: bool
    failure_reason: str | None = None
    remediation: str | None = None
    findings: list[StageFindingRef]
    evidence_ids: list[str]
    can_retry: bool


class PipelineLogLine(ApiModel):
    timestamp: str
    level: LogLevel
    message: str


class PullRequestRef(ApiModel):
    number: int
    title: str
    url: str


class CommitInfo(ApiModel):
    sha: str
    message: str
    author: str
    branch: str
    pull_request: PullRequestRef | None = None


class PipelineRun(ApiModel):
    id: str
    application_id: str
    commit: CommitInfo
    trigger: TriggerType
    environment: EnvironmentName
    status: PipelineRunStatus
    security_gate: Literal["passed", "failed", "in-progress", "waived"]
    approval_status: ApprovalDecision
    artifact_version: str
    started_at: str
    finished_at: str | None = None
    duration_seconds: int | None = None
    stages: list[PipelineStage]
    previous_run_id: str | None = None


class ComplianceMapping(ApiModel):
    framework_id: FrameworkId
    control_id: str


class SuppressionEntry(ApiModel):
    date: str
    by: str
    reason: str


class SecurityFinding(ApiModel):
    id: str
    title: str
    description: str
    application_id: str
    repository_id: str
    branch: str
    environment: EnvironmentName
    scanner: Scanner
    type: FindingType
    severity: Severity
    status: FindingStatus
    rule_id: str
    cve: str | None = None
    affected_resource: str
    file_path: str | None = None
    line_number: int | None = None
    exploitability: Literal["high", "medium", "low", "unknown"]
    reachability: Literal["reachable", "not-reachable", "unknown"]
    business_impact: str
    suggested_fix: str
    ai_explanation: str
    compliance_mappings: list[ComplianceMapping]
    evidence: list[str]
    suppression_history: list[SuppressionEntry]
    owner_user_id: str
    sla_due_date: str
    first_detected_at: str
    pipeline_run_id: str | None = None
    blocks_deployment: bool


class ComplianceControl(ApiModel):
    id: str
    framework_id: FrameworkId
    control_id: str
    title: str
    description: str
    status: ControlStatus
    evidence_ids: list[str]
    related_stage_definition_id: str | None = None
    related_finding_ids: list[str]
    owner_user_id: str
    last_validated_at: str
    next_review_at: str


class ComplianceFramework(ApiModel):
    id: FrameworkId
    name: str
    version: str
    coverage_percent: int
    controls: list[ComplianceControl]


class PlanSummary(ApiModel):
    add: int
    change: int
    destroy: int


class PolicyViolation(ApiModel):
    policy: str
    severity: Severity
    resource: str
    message: str


class ModuleVersion(ApiModel):
    module: str
    version: str


class InfrastructureResourceChange(ApiModel):
    address: str
    resource_type: str
    action: Literal["create", "update", "delete", "replace", "no-op"]
    before: dict[str, str] | None = None
    after: dict[str, str] | None = None
    security_notes: str | None = None


class InfrastructurePlan(ApiModel):
    id: str
    application_id: str
    pipeline_run_id: str
    environment: EnvironmentName
    created_at: str
    summary: PlanSummary
    monthly_cost_estimate_usd: float
    cost_delta_usd: float
    policy_violations: list[PolicyViolation]
    drift_status: DriftStatus
    module_versions: list[ModuleVersion]
    state_status: Literal["locked", "unlocked", "stale"]
    last_apply_at: str | None = None
    requires_approval: bool
    resources: list[InfrastructureResourceChange]


class Deployment(ApiModel):
    id: str
    application_id: str
    environment: EnvironmentName
    version: str
    previous_version: str | None = None
    status: DeploymentStatus
    strategy: DeploymentStrategy
    argo_sync_status: ArgoSyncStatus
    security_gate: Literal["passed", "failed", "waived"]
    deployed_at: str
    deployed_by: str
    canary_percent: int | None = None
    pipeline_run_id: str | None = None


class AuditEvent(ApiModel):
    id: str
    timestamp: str
    actor: str
    actor_role: Role
    action: str
    target: str
    target_type: str
    outcome: Literal["success", "denied", "failure"]
    detail: str


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
