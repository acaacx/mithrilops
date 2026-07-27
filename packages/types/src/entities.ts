import type {
  AICapability,
  ApprovalDecision,
  ArgoSyncStatus,
  ControlStatus,
  DeploymentStatus,
  DeploymentStrategy,
  DriftStatus,
  EnvironmentName,
  FindingStatus,
  FindingType,
  FrameworkId,
  IncidentStatus,
  IntegrationStatus,
  LogLevel,
  Permission,
  PipelineRunStatus,
  RemediationStatus,
  RiskLevel,
  Role,
  Scanner,
  Severity,
  StageStatus,
  TriggerType,
} from "./enums";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  teamId: string;
  avatarInitials: string;
}

export interface Team {
  id: string;
  name: string;
  businessUnit: string;
}

export interface Repository {
  id: string;
  name: string;
  url: string;
  defaultBranch: string;
  provider: "github";
}

export interface SLO {
  metric: "availability" | "latency-p95" | "error-rate";
  target: string;
  current: string;
  status: "met" | "at-risk" | "breached";
}

export interface Application {
  id: string;
  name: string;
  slug: string;
  description: string;
  ownerUserId: string;
  teamId: string;
  repositoryId: string;
  technology: string[];
  cloudEnvironment: string;
  currentVersion: string;
  deploymentStatus: DeploymentStatus;
  pipelineHealth: "healthy" | "unstable" | "failing";
  securityScore: number;
  complianceScore: number;
  lastDeploymentAt: string;
  openVulnerabilities: { critical: number; high: number; medium: number; low: number };
  availability: string;
  riskLevel: RiskLevel;
  slos: SLO[];
  argoAppName: string;
  errorRate: string;
  latencyP95: string;
}

export interface PipelineStageDefinition {
  id: string;
  name: string;
  tool: string;
  gate: boolean;
  phase: "ci" | "security" | "artifact" | "infrastructure" | "deploy" | "verify";
}

export interface StageFindingRef {
  findingId: string;
  severity: Severity;
  title: string;
}

export interface PipelineStage {
  id: string;
  definitionId: string;
  name: string;
  tool: string;
  phase: "ci" | "security" | "artifact" | "infrastructure" | "deploy" | "verify";
  status: StageStatus;
  startedAt?: string;
  finishedAt?: string;
  durationSeconds?: number;
  owner: string;
  blocksDeployment: boolean;
  failureReason?: string;
  remediation?: string;
  findings: StageFindingRef[];
  evidenceIds: string[];
  canRetry: boolean;
}

export interface PipelineLogLine {
  timestamp: string;
  level: LogLevel;
  message: string;
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  branch: string;
  pullRequest?: { number: number; title: string; url: string };
}

export interface PipelineRun {
  id: string;
  applicationId: string;
  commit: CommitInfo;
  trigger: TriggerType;
  environment: EnvironmentName;
  status: PipelineRunStatus;
  securityGate: "passed" | "failed" | "in-progress" | "waived";
  approvalStatus: ApprovalDecision;
  artifactVersion: string;
  startedAt: string;
  finishedAt?: string;
  durationSeconds?: number;
  stages: PipelineStage[];
  previousRunId?: string;
}

export interface Approval {
  id: string;
  runId: string;
  environment: EnvironmentName;
  requiredRole: Role;
  decision: ApprovalDecision;
  decidedBy?: string;
  decidedAt?: string;
  comment?: string;
}

export interface ComplianceMapping {
  frameworkId: FrameworkId;
  controlId: string;
}

export interface SecurityFinding {
  id: string;
  title: string;
  description: string;
  applicationId: string;
  repositoryId: string;
  branch: string;
  environment: EnvironmentName;
  scanner: Scanner;
  type: FindingType;
  severity: Severity;
  status: FindingStatus;
  ruleId: string;
  cve?: string;
  affectedResource: string;
  filePath?: string;
  lineNumber?: number;
  exploitability: "high" | "medium" | "low" | "unknown";
  reachability: "reachable" | "not-reachable" | "unknown";
  businessImpact: string;
  suggestedFix: string;
  aiExplanation: string;
  complianceMappings: ComplianceMapping[];
  evidence: string[];
  suppressionHistory: { date: string; by: string; reason: string }[];
  ownerUserId: string;
  slaDueDate: string;
  firstDetectedAt: string;
  pipelineRunId?: string;
  blocksDeployment: boolean;
}

export interface ComplianceControl {
  id: string;
  frameworkId: FrameworkId;
  controlId: string;
  title: string;
  description: string;
  status: ControlStatus;
  evidenceIds: string[];
  relatedStageDefinitionId?: string;
  relatedFindingIds: string[];
  ownerUserId: string;
  lastValidatedAt: string;
  nextReviewAt: string;
}

export interface ComplianceFramework {
  id: FrameworkId;
  name: string;
  version: string;
  coveragePercent: number;
  controls: ComplianceControl[];
}

export interface ComplianceEvidence {
  id: string;
  name: string;
  type: "scan-report" | "log-extract" | "attestation" | "sbom" | "signature" | "screenshot" | "policy-result";
  createdAt: string;
  source: string;
  sha256: string;
}

export interface InfrastructureResourceChange {
  address: string;
  resourceType: string;
  action: "create" | "update" | "delete" | "replace" | "no-op";
  before?: Record<string, string>;
  after?: Record<string, string>;
  securityNotes?: string;
}

export interface InfrastructurePlan {
  id: string;
  applicationId: string;
  pipelineRunId: string;
  environment: EnvironmentName;
  createdAt: string;
  summary: { add: number; change: number; destroy: number };
  monthlyCostEstimateUsd: number;
  costDeltaUsd: number;
  policyViolations: { policy: string; severity: Severity; resource: string; message: string }[];
  driftStatus: DriftStatus;
  moduleVersions: { module: string; version: string }[];
  stateStatus: "locked" | "unlocked" | "stale";
  lastApplyAt?: string;
  requiresApproval: boolean;
  resources: InfrastructureResourceChange[];
}

export interface Deployment {
  id: string;
  applicationId: string;
  environment: EnvironmentName;
  version: string;
  previousVersion?: string;
  status: DeploymentStatus;
  strategy: DeploymentStrategy;
  argoSyncStatus: ArgoSyncStatus;
  securityGate: "passed" | "failed" | "waived";
  deployedAt: string;
  deployedBy: string;
  canaryPercent?: number;
  pipelineRunId?: string;
}

export interface RiskException {
  id: string;
  findingId: string;
  approvedBy: string;
  reason: string;
  expiresAt: string;
  createdAt: string;
}

export interface RemediationTask {
  id: string;
  findingId: string;
  title: string;
  assigneeUserId: string;
  status: RemediationStatus;
  createdAt: string;
  dueAt: string;
  tracker: "github-issues" | "jira";
  trackerRef: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  actor: string;
  actorRole: Role;
  action: string;
  target: string;
  targetType: string;
  outcome: "success" | "denied" | "failure";
  detail: string;
}

export interface Integration {
  id: string;
  name: string;
  category: "scm" | "ci" | "security" | "registry" | "iac" | "cd" | "observability" | "identity" | "tracking";
  status: IntegrationStatus;
  lastSyncAt?: string;
  description: string;
}

export interface ArchitectureNodeData {
  id: string;
  label: string;
  kind: string;
  status: "healthy" | "warning" | "critical" | "unknown";
  owner: string;
  description: string;
  findingsCount: number;
  dependencies: string[];
  relatedStageDefinitionIds: string[];
}

export interface ArchitectureDiagram {
  id: string;
  applicationId: string;
  nodes: ArchitectureNodeData[];
  edges: { id: string; source: string; target: string; label?: string }[];
}

export interface AIRecommendation {
  id: string;
  capability: AICapability;
  title: string;
  summary: string;
  detail: string[];
  confidence: "high" | "medium" | "low";
  supportingEvidence: string[];
  affectedAssets: string[];
  riskLevel: RiskLevel;
  suggestedAction: string;
  disclaimer: string;
  generatedAt: string;
}

export interface Incident {
  id: string;
  applicationId: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  startedAt: string;
  summary: string;
}

export interface SessionUser extends User {
  permissions: Permission[];
}
