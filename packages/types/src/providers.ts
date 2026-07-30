import type {
  AIRecommendation,
  Application,
  Approval,
  ArchitectureDiagram,
  AuditEvent,
  ComplianceFramework,
  Deployment,
  InfrastructurePlan,
  Integration,
  PipelineLogLine,
  PipelineRun,
  SecurityFinding,
} from "./entities";
import type {
  EnvironmentName,
  FindingStatus,
  FindingType,
  FrameworkId,
  PipelineRunStatus,
  Scanner,
  Severity,
} from "./enums";
import type { ApprovalRequest, GeneratorRequest, GeneratorResult } from "./schemas";

export interface PipelineRunFilters {
  applicationId?: string;
  status?: PipelineRunStatus;
  environment?: EnvironmentName;
  branch?: string;
  search?: string;
}

export interface FindingFilters {
  applicationId?: string;
  repositoryId?: string;
  branch?: string;
  environment?: EnvironmentName;
  scanner?: Scanner;
  type?: FindingType;
  severity?: Severity;
  status?: FindingStatus;
  ownerUserId?: string;
  frameworkId?: FrameworkId;
  pipelineRunId?: string;
  search?: string;
}

export interface PipelineProvider {
  listRuns(filters?: PipelineRunFilters): Promise<PipelineRun[]>;
  getRun(runId: string): Promise<PipelineRun>;
  getStageLogs(runId: string, stageId: string): Promise<PipelineLogLine[]>;
  retryStage(runId: string, stageId: string): Promise<void>;
  listApprovals(runId: string): Promise<Approval[]>;
  approveDeployment(runId: string, approval: ApprovalRequest): Promise<void>;
}

export interface SecurityProvider {
  listFindings(filters?: FindingFilters): Promise<SecurityFinding[]>;
  getFinding(findingId: string): Promise<SecurityFinding>;
  updateFindingStatus(findingId: string, status: FindingStatus, reason?: string): Promise<void>;
}

export interface DeploymentProvider {
  listApplications(): Promise<Application[]>;
  getApplication(applicationId: string): Promise<Application>;
  listDeployments(applicationId?: string): Promise<Deployment[]>;
  syncApplication(applicationId: string): Promise<void>;
  promote(applicationId: string, toEnvironment: EnvironmentName): Promise<void>;
  rollback(applicationId: string, revision: string): Promise<void>;
}

export interface InfrastructureProvider {
  listPlans(applicationId?: string): Promise<InfrastructurePlan[]>;
  getPlan(planId: string): Promise<InfrastructurePlan>;
}

export interface ComplianceProvider {
  listFrameworks(): Promise<ComplianceFramework[]>;
  getFramework(frameworkId: FrameworkId): Promise<ComplianceFramework>;
}

export interface ArchitectureProvider {
  getDiagram(applicationId: string): Promise<ArchitectureDiagram>;
}

export interface AuditProvider {
  listEvents(limit?: number): Promise<AuditEvent[]>;
  record(event: Omit<AuditEvent, "id" | "timestamp">): Promise<void>;
}

export interface IntegrationProvider {
  listIntegrations(): Promise<Integration[]>;
}

export interface AIService {
  summarizeRun(runId: string): Promise<AIRecommendation>;
  explainFinding(findingId: string): Promise<AIRecommendation>;
  summarizeTerraformPlan(planId: string): Promise<AIRecommendation>;
  scoreDeploymentRisk(runId: string): Promise<AIRecommendation>;
  executiveSummary(): Promise<AIRecommendation>;
  generatePipeline(request: GeneratorRequest): Promise<GeneratorResult>;
}
