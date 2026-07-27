export const ROLES = [
  "developer",
  "devsecops-engineer",
  "security-engineer",
  "platform-engineer",
  "application-owner",
  "compliance-reviewer",
  "release-approver",
  "administrator",
] as const;
export type Role = (typeof ROLES)[number];

export const ENVIRONMENTS = ["development", "test", "staging", "production"] as const;
export type EnvironmentName = (typeof ENVIRONMENTS)[number];

export const PIPELINE_RUN_STATUSES = [
  "succeeded",
  "running",
  "failed",
  "blocked",
  "waiting-approval",
  "rolled-back",
  "cancelled",
] as const;
export type PipelineRunStatus = (typeof PIPELINE_RUN_STATUSES)[number];

export const STAGE_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
  "blocked",
  "waiting-approval",
] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

export const SEVERITIES = ["critical", "high", "medium", "low", "informational"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const FINDING_STATUSES = [
  "open",
  "in-remediation",
  "accepted-risk",
  "false-positive",
  "resolved",
] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const FINDING_TYPES = [
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
] as const;
export type FindingType = (typeof FINDING_TYPES)[number];

export const SCANNERS = [
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
] as const;
export type Scanner = (typeof SCANNERS)[number];

export const FRAMEWORKS = [
  "owasp-top-10",
  "cis-benchmarks",
  "nist-csf",
  "iso-27001",
  "soc-2",
  "pci-dss",
  "azure-security-benchmark",
] as const;
export type FrameworkId = (typeof FRAMEWORKS)[number];

export type ControlStatus = "passed" | "failed" | "needs-evidence" | "exception" | "not-applicable";
export type DeploymentStrategy = "rolling" | "canary" | "blue-green" | "recreate";
export type DeploymentStatus = "healthy" | "degraded" | "progressing" | "failed" | "rolled-back";
export type ArgoSyncStatus = "synced" | "out-of-sync" | "syncing" | "unknown";
export type DriftStatus = "in-sync" | "drift-detected" | "unknown";
export type ApprovalDecision = "approved" | "rejected" | "changes-requested" | "pending";
export type RiskLevel = "critical" | "high" | "medium" | "low";
export type TriggerType = "push" | "pull-request" | "manual" | "schedule" | "rollback";
export type IncidentStatus = "active" | "mitigated" | "resolved";
export type RemediationStatus = "open" | "in-progress" | "done" | "wont-fix";
export type IntegrationStatus = "connected" | "degraded" | "disconnected" | "simulated";
export type LogLevel = "info" | "warn" | "error" | "debug";
export type AICapability =
  | "pipeline-failure-summary"
  | "finding-explanation"
  | "remediation-recommendation"
  | "terraform-risk-summary"
  | "architecture-generation"
  | "pipeline-generation"
  | "deployment-risk-score"
  | "change-impact-analysis"
  | "compliance-gap-analysis"
  | "executive-summary";

export const PERMISSIONS = [
  "deployment.approve",
  "deployment.reject",
  "deployment.request-changes",
  "deployment.promote",
  "deployment.rollback",
  "pipeline.retry-stage",
  "pipeline.trigger",
  "risk.accept",
  "finding.update-status",
  "remediation.create",
  "evidence.download",
  "compliance.review",
  "integration.manage",
  "settings.manage",
  "audit.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
