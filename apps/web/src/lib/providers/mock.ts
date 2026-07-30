import { stageLogs } from "@secureflow/mock-data";
import type {
  ApprovalRequest,
  ArchitectureProvider,
  AuditEvent,
  AuditProvider,
  ComplianceProvider,
  DeploymentProvider,
  EnvironmentName,
  FindingFilters,
  FindingStatus,
  InfrastructureProvider,
  IntegrationProvider,
  PipelineProvider,
  PipelineRunFilters,
} from "@secureflow/types";
import { delay, mockState, nextAuditId } from "./mock-state";
import { filterAndSortFindings, filterAndSortRuns, sortAuditEvents } from "./filters";

/**
 * Mock provider implementations. Real integrations (GitHub, Argo CD, scanners)
 * plug in behind the same interfaces — UI code never imports mock state directly.
 */

export const pipelineProvider: PipelineProvider = {
  async listRuns(filters?: PipelineRunFilters) {
    return delay(filterAndSortRuns(mockState.runs, filters));
  },

  async getRun(runId: string) {
    const run = mockState.runs.find((r) => r.id === runId);
    if (!run) throw new Error(`Pipeline run not found: ${runId}`);
    return delay(structuredClone(run));
  },

  async getStageLogs(runId: string, stageId: string) {
    const run = mockState.runs.find((r) => r.id === runId);
    const stage = run?.stages.find((s) => s.id === stageId || s.definitionId === stageId);
    if (!run || !stage) return delay([]);
    return delay(stageLogs(runId, stage.definitionId), 150);
  },

  async retryStage(runId: string, stageId: string) {
    const run = mockState.runs.find((r) => r.id === runId);
    const stage = run?.stages.find((s) => s.id === stageId);
    if (!run || !stage) throw new Error("Stage not found");
    stage.status = "running";
    stage.failureReason = undefined;
    stage.startedAt = new Date().toISOString();
    stage.finishedAt = undefined;
    run.status = "running";
    await auditProvider.record({
      actor: "You",
      actorRole: "devsecops-engineer",
      action: "stage.retried",
      target: `${runId} / ${stage.definitionId}`,
      targetType: "PipelineStage",
      outcome: "success",
      detail: `Manual retry of '${stage.name}'.`,
    });
    return delay(undefined, 120);
  },

  async listApprovals(runId: string) {
    return delay(mockState.approvals.filter((a) => a.runId === runId));
  },

  async approveDeployment(runId: string, approval: ApprovalRequest) {
    const run = mockState.runs.find((r) => r.id === runId);
    if (!run) throw new Error("Run not found");
    run.approvalStatus = approval.decision;
    const pending = mockState.approvals.find((a) => a.runId === runId && a.decision === "pending");
    if (pending) {
      pending.decision = approval.decision;
      pending.decidedBy = "You";
      pending.decidedAt = new Date().toISOString();
      pending.comment = approval.comment;
    }
    if (approval.decision === "approved") {
      run.status = "running";
      const approvalStage = run.stages.find((s) => s.status === "waiting-approval");
      if (approvalStage) {
        approvalStage.status = "succeeded";
        approvalStage.finishedAt = new Date().toISOString();
      }
    } else {
      run.status = approval.decision === "rejected" ? "cancelled" : "blocked";
    }
    return delay(undefined, 150);
  },
};

export const securityProvider = {
  async listFindings(filters?: FindingFilters) {
    return delay(filterAndSortFindings(mockState.findings, filters));
  },

  async getFinding(findingId: string) {
    const finding = mockState.findings.find((f) => f.id === findingId);
    if (!finding) throw new Error(`Finding not found: ${findingId}`);
    return delay(structuredClone(finding));
  },

  async updateFindingStatus(findingId: string, status: FindingStatus, reason?: string) {
    const finding = mockState.findings.find((f) => f.id === findingId);
    if (!finding) throw new Error("Finding not found");
    finding.status = status;
    if (reason) {
      finding.suppressionHistory.push({
        date: new Date().toISOString(),
        by: "You",
        reason,
      });
    }
    await auditProvider.record({
      actor: "You",
      actorRole: "security-engineer",
      action: "finding.status-changed",
      target: `${findingId} → ${status}`,
      targetType: "SecurityFinding",
      outcome: "success",
      detail: reason ?? "Status updated from the security command center.",
    });
    return delay(undefined, 120);
  },
};

export const deploymentProvider: DeploymentProvider = {
  async listApplications() {
    return delay([...mockState.applications]);
  },
  async getApplication(applicationId: string) {
    const app = mockState.applications.find((a) => a.id === applicationId);
    if (!app) throw new Error(`Application not found: ${applicationId}`);
    return delay(structuredClone(app));
  },
  async listDeployments(applicationId?: string) {
    const items = applicationId
      ? mockState.deployments.filter((d) => d.applicationId === applicationId)
      : [...mockState.deployments];
    return delay(items);
  },
  async syncApplication(applicationId: string) {
    for (const d of mockState.deployments.filter((x) => x.applicationId === applicationId)) {
      d.argoSyncStatus = "synced";
    }
    return delay(undefined, 400);
  },
  async promote(applicationId: string, toEnvironment: EnvironmentName) {
    const order: EnvironmentName[] = ["development", "test", "staging", "production"];
    const fromEnv = order[order.indexOf(toEnvironment) - 1];
    const source = mockState.deployments.find(
      (d) => d.applicationId === applicationId && d.environment === fromEnv,
    );
    const target = mockState.deployments.find(
      (d) => d.applicationId === applicationId && d.environment === toEnvironment,
    );
    if (source && target) {
      target.previousVersion = target.version;
      target.version = source.version;
      target.status = "progressing";
      target.argoSyncStatus = "syncing";
      target.deployedAt = new Date().toISOString();
      target.deployedBy = "You (promotion)";
    }
    await auditProvider.record({
      actor: "You",
      actorRole: "release-approver",
      action: "deployment.promoted",
      target: `${applicationId} → ${toEnvironment}`,
      targetType: "Deployment",
      outcome: "success",
      detail: `Promoted ${source?.version ?? "latest"} to ${toEnvironment}.`,
    });
    return delay(undefined, 300);
  },
  async rollback(applicationId: string, revision: string) {
    const prod = mockState.deployments.find(
      (d) => d.applicationId === applicationId && d.environment === "production",
    );
    if (prod) {
      prod.previousVersion = prod.version;
      prod.version = revision;
      prod.status = "rolled-back";
      prod.deployedAt = new Date().toISOString();
      prod.deployedBy = "You (manual rollback)";
    }
    await auditProvider.record({
      actor: "You",
      actorRole: "release-approver",
      action: "deployment.rolled-back",
      target: `${applicationId} production → ${revision}`,
      targetType: "Deployment",
      outcome: "success",
      detail: `Manual rollback to ${revision}.`,
    });
    return delay(undefined, 350);
  },
};

export const infrastructureProvider: InfrastructureProvider = {
  async listPlans(applicationId?: string) {
    const plans = applicationId
      ? mockState.plans.filter((p) => p.applicationId === applicationId)
      : [...mockState.plans];
    return delay(plans);
  },
  async getPlan(planId: string) {
    const plan = mockState.plans.find((p) => p.id === planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);
    return delay(structuredClone(plan));
  },
};

export const complianceProvider: ComplianceProvider = {
  async listFrameworks() {
    return delay([...mockState.frameworks]);
  },
  async getFramework(frameworkId) {
    const fw = mockState.frameworks.find((f) => f.id === frameworkId);
    if (!fw) throw new Error(`Framework not found: ${frameworkId}`);
    return delay(structuredClone(fw));
  },
};

export const architectureProvider: ArchitectureProvider = {
  async getDiagram(applicationId: string) {
    const diagram = mockState.diagrams.find((d) => d.applicationId === applicationId);
    if (!diagram) throw new Error(`Diagram not found for: ${applicationId}`);
    return delay(structuredClone(diagram));
  },
};

export const auditProvider: AuditProvider = {
  async listEvents(limit = 100) {
    return delay(sortAuditEvents(mockState.audit, limit));
  },
  async record(event: Omit<AuditEvent, "id" | "timestamp">) {
    mockState.audit.unshift({
      ...event,
      id: nextAuditId(),
      timestamp: new Date().toISOString(),
    });
  },
};

export const integrationProvider: IntegrationProvider = {
  async listIntegrations() {
    return delay([...mockState.integrations]);
  },
};
