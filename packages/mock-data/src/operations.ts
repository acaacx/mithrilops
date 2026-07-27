import type { AuditEvent, Integration, RemediationTask, RiskException } from "@secureflow/types";

const now = Date.now();
const hoursAgo = (n: number) => new Date(now - n * 3_600_000).toISOString();
const daysAgo = (n: number) => new Date(now - n * 86_400_000).toISOString();
const daysAhead = (n: number) => new Date(now + n * 86_400_000).toISOString();

export const auditEvents: AuditEvent[] = [
  { id: "aud-1", timestamp: hoursAgo(2), actor: "Priya Natarajan", actorRole: "security-engineer", action: "approval.granted", target: "run-1482 (production, security review)", targetType: "PipelineRun", outcome: "success", detail: "Security approval for payments-api v2.15.0-rc.2; SCA finding tracked with SLA." },
  { id: "aud-2", timestamp: hoursAgo(6), actor: "Priya Natarajan", actorRole: "security-engineer", action: "approval.rejected", target: "run-2210 (staging)", targetType: "PipelineRun", outcome: "success", detail: "Rejected: critical CVE-2025-21614 with public exploit; no waiver." },
  { id: "aud-3", timestamp: hoursAgo(8), actor: "SecureFlow gate", actorRole: "administrator", action: "gate.blocked", target: "run-2210 / image-scan", targetType: "PipelineStage", outcome: "success", detail: "Trivy gate blocked deployment on critical CVE." },
  { id: "aud-4", timestamp: hoursAgo(11), actor: "Argo Rollouts", actorRole: "administrator", action: "deployment.rolled-back", target: "reporting-platform production", targetType: "Deployment", outcome: "success", detail: "Automated rollback v4.2.0 → v4.1.0 on SLO burn-rate breach (4.2x/10m)." },
  { id: "aud-5", timestamp: hoursAgo(12), actor: "Tomás Herrera", actorRole: "developer", action: "deployment.approve", target: "run-1482 (production)", targetType: "PipelineRun", outcome: "denied", detail: "RBAC denied: role 'developer' lacks deployment.approve." },
  { id: "aud-6", timestamp: daysAgo(1), actor: "Elin Sørensen", actorRole: "release-approver", action: "deployment.promoted", target: "payments-api staging → production readiness", targetType: "Deployment", outcome: "success", detail: "Promoted v2.15.0-rc.2 to production approval queue." },
  { id: "aud-7", timestamp: daysAgo(1.2), actor: "Marcus Oyelaran", actorRole: "platform-engineer", action: "stage.retried", target: "run-0862 / checkov", targetType: "PipelineStage", outcome: "failure", detail: "Retry failed with identical CKV_AZURE_109 violation." },
  { id: "aud-8", timestamp: daysAgo(2), actor: "Derek Mensah", actorRole: "application-owner", action: "risk.accepted", target: "find-missing-encryption", targetType: "SecurityFinding", outcome: "success", detail: "REX-31 accepted for 45 days pending CMK platform rollout." },
  { id: "aud-9", timestamp: daysAgo(3), actor: "Aiko Tanaka", actorRole: "compliance-reviewer", action: "evidence.downloaded", target: "SOC 2 CC8.1 evidence package", targetType: "ComplianceEvidence", outcome: "success", detail: "Quarterly audit preparation export." },
  { id: "aud-10", timestamp: daysAgo(4), actor: "Priya Natarajan", actorRole: "security-engineer", action: "finding.status-changed", target: "find-sast-sqli → false-positive", targetType: "SecurityFinding", outcome: "success", detail: "Confirmed enum-mapped value; refactor tracked as REM-3098." },
];

export const integrations: Integration[] = [
  { id: "int-github", name: "GitHub", category: "scm", status: "simulated", lastSyncAt: hoursAgo(0.1), description: "Repositories, pull requests, branch protection." },
  { id: "int-actions", name: "GitHub Actions", category: "ci", status: "simulated", lastSyncAt: hoursAgo(0.1), description: "Workflow runs and OIDC federation to Azure." },
  { id: "int-azdo", name: "Azure DevOps", category: "ci", status: "disconnected", description: "Future provider — adapter interface ready, not configured." },
  { id: "int-sonar", name: "SonarQube", category: "security", status: "simulated", lastSyncAt: hoursAgo(2), description: "SAST and code-quality gates." },
  { id: "int-snyk", name: "Snyk", category: "security", status: "simulated", lastSyncAt: hoursAgo(2), description: "Dependency (SCA) scanning." },
  { id: "int-trivy", name: "Trivy", category: "security", status: "simulated", lastSyncAt: hoursAgo(1), description: "Container image and configuration scanning." },
  { id: "int-checkov", name: "Checkov", category: "security", status: "simulated", lastSyncAt: hoursAgo(3), description: "Terraform policy-as-code scanning." },
  { id: "int-tfsec", name: "tfsec", category: "security", status: "simulated", lastSyncAt: hoursAgo(3), description: "Terraform static analysis." },
  { id: "int-gitleaks", name: "Gitleaks", category: "security", status: "simulated", lastSyncAt: hoursAgo(1), description: "Secret detection in code and history." },
  { id: "int-zap", name: "OWASP ZAP", category: "security", status: "simulated", lastSyncAt: hoursAgo(20), description: "DAST scans against staging." },
  { id: "int-syft", name: "Syft", category: "security", status: "simulated", lastSyncAt: hoursAgo(1), description: "SBOM generation (SPDX)." },
  { id: "int-cosign", name: "Cosign", category: "security", status: "simulated", lastSyncAt: hoursAgo(1), description: "Image signing and verification." },
  { id: "int-acr", name: "Azure Container Registry", category: "registry", status: "simulated", lastSyncAt: hoursAgo(0.5), description: "Private image registry with content trust." },
  { id: "int-terraform", name: "Terraform", category: "iac", status: "simulated", lastSyncAt: hoursAgo(4), description: "Plans, applies, state and drift." },
  { id: "int-argo", name: "Argo CD", category: "cd", status: "simulated", lastSyncAt: hoursAgo(0.2), description: "GitOps sync status and health." },
  { id: "int-k8s", name: "Kubernetes", category: "cd", status: "simulated", lastSyncAt: hoursAgo(0.2), description: "Workload status from AKS clusters." },
  { id: "int-prom", name: "Prometheus", category: "observability", status: "simulated", lastSyncAt: hoursAgo(0.1), description: "Metrics and SLO burn-rate alerts." },
  { id: "int-grafana", name: "Grafana", category: "observability", status: "simulated", lastSyncAt: hoursAgo(0.1), description: "Dashboards for release health." },
  { id: "int-azmon", name: "Azure Monitor", category: "observability", status: "simulated", lastSyncAt: hoursAgo(0.3), description: "Platform metrics, logs, and alerts." },
  { id: "int-defender", name: "Microsoft Defender for Cloud", category: "security", status: "simulated", lastSyncAt: hoursAgo(1), description: "CSPM findings and workload protection." },
  { id: "int-entra", name: "Microsoft Entra ID", category: "identity", status: "simulated", lastSyncAt: hoursAgo(0.5), description: "Authentication, workload identities, RBAC." },
  { id: "int-azpolicy", name: "Azure Policy", category: "security", status: "simulated", lastSyncAt: hoursAgo(2), description: "Guardrails and compliance evaluation." },
  { id: "int-jira", name: "Jira / GitHub Issues", category: "tracking", status: "simulated", lastSyncAt: hoursAgo(5), description: "Remediation task tracking." },
];

export const riskExceptions: RiskException[] = [
  { id: "rex-31", findingId: "find-missing-encryption", approvedBy: "Derek Mensah", reason: "CMK platform rollout lands Q3; interim risk bounded (TLS in transit, MS-managed keys at rest).", createdAt: daysAgo(20), expiresAt: daysAhead(45) },
];

export const remediationTasks: RemediationTask[] = [
  { id: "rem-3121", findingId: "find-dep-axios", title: "Upgrade axios and disable webhook redirects", assigneeUserId: "u-rowan", status: "in-progress", createdAt: daysAgo(2), dueAt: daysAhead(18), tracker: "github-issues", trackerRef: "meridian/payments-api#874" },
  { id: "rem-3122", findingId: "find-cve-portal", title: "Rebuild portal on patched base image", assigneeUserId: "u-tomas", status: "open", createdAt: daysAgo(1), dueAt: daysAhead(2), tracker: "github-issues", trackerRef: "meridian/customer-portal#1431" },
  { id: "rem-3119", findingId: "find-secret-notify", title: "Rotate Twilio token + purge history", assigneeUserId: "u-derek", status: "in-progress", createdAt: daysAgo(6), dueAt: daysAhead(1), tracker: "jira", trackerRef: "SEC-2211" },
  { id: "rem-3098", findingId: "find-sast-sqli", title: "Refactor statement search to parameterized query", assigneeUserId: "u-tomas", status: "open", createdAt: daysAgo(10), dueAt: daysAhead(30), tracker: "jira", trackerRef: "PORT-981" },
];
