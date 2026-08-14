import type {
  Approval,
  ApprovalRequest,
  ArchitectureDiagram,
  ArchitectureProvider,
  Application,
  AuditEvent,
  AuditProvider,
  ComplianceFramework,
  ComplianceProvider,
  Deployment,
  DeploymentProvider,
  EnvironmentName,
  FindingFilters,
  FindingStatus,
  InfrastructurePlan,
  InfrastructureProvider,
  Integration,
  IntegrationProvider,
  PipelineLogLine,
  PipelineProvider,
  PipelineRun,
  PipelineRunFilters,
  SecurityFinding,
  SecurityProvider,
} from "@secureflow/types";
import { filterAndSortFindings, filterAndSortRuns, sortAuditEvents } from "./filters";
import { getAccessToken, handleUnauthorized } from "@/lib/auth/token";

/**
 * HTTP provider implementations. Same-origin `/api/*` paths — the Vite dev
 * server proxies them to the FastAPI process (see vite.config.ts); in
 * production the SPA and API sit behind the same origin.
 *
 * List endpoints return the full dataset; filtering/sorting happens client-side
 * via the same shared functions the mock providers use, so both modes behave
 * identically.
 */

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken(); // null in demo mode
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    // 401 with a token means it expired or was revoked mid-session: hand off
    // to MSAL for an interactive redirect, and still surface the error below.
    if (response.status === 401 && token !== null) handleUnauthorized();
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // non-JSON error body; keep the status text
    }
    throw new Error(`API request failed: ${detail}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const post = (path: string, body?: unknown) =>
  api<void>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const pipelineProvider: PipelineProvider = {
  async listRuns(filters?: PipelineRunFilters) {
    return filterAndSortRuns(await api<PipelineRun[]>("/api/runs"), filters);
  },
  getRun: (runId) => api<PipelineRun>(`/api/runs/${runId}`),
  getStageLogs: (runId, stageId) =>
    api<PipelineLogLine[]>(`/api/runs/${runId}/stages/${stageId}/logs`),
  retryStage: (runId, stageId) => post(`/api/runs/${runId}/stages/${stageId}/retry`),
  listApprovals: (runId) => api<Approval[]>(`/api/runs/${runId}/approvals`),
  approveDeployment: (runId, approval: ApprovalRequest) =>
    post(`/api/runs/${runId}/approval`, approval),
};

export const securityProvider: SecurityProvider = {
  async listFindings(filters?: FindingFilters) {
    return filterAndSortFindings(await api<SecurityFinding[]>("/api/findings"), filters);
  },
  getFinding: (findingId) => api<SecurityFinding>(`/api/findings/${findingId}`),
  updateFindingStatus: (findingId: string, status: FindingStatus, reason?: string) =>
    api<void>(`/api/findings/${findingId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, reason }),
    }),
};

export const deploymentProvider: DeploymentProvider = {
  listApplications: () => api<Application[]>("/api/applications"),
  getApplication: (applicationId) => api<Application>(`/api/applications/${applicationId}`),
  async listDeployments(applicationId?: string) {
    const deployments = await api<Deployment[]>("/api/deployments");
    return applicationId
      ? deployments.filter((d) => d.applicationId === applicationId)
      : deployments;
  },
  syncApplication: (applicationId) => post(`/api/applications/${applicationId}/sync`),
  promote: (applicationId, toEnvironment: EnvironmentName) =>
    post(`/api/applications/${applicationId}/promote`, { toEnvironment }),
  rollback: (applicationId, revision: string) =>
    post(`/api/applications/${applicationId}/rollback`, { revision }),
};

export const infrastructureProvider: InfrastructureProvider = {
  async listPlans(applicationId?: string) {
    const plans = await api<InfrastructurePlan[]>("/api/plans");
    return applicationId ? plans.filter((p) => p.applicationId === applicationId) : plans;
  },
  getPlan: (planId) => api<InfrastructurePlan>(`/api/plans/${planId}`),
};

export const complianceProvider: ComplianceProvider = {
  listFrameworks: () => api<ComplianceFramework[]>("/api/frameworks"),
  getFramework: (frameworkId) => api<ComplianceFramework>(`/api/frameworks/${frameworkId}`),
};

export const architectureProvider: ArchitectureProvider = {
  getDiagram: (applicationId) => api<ArchitectureDiagram>(`/api/architecture/${applicationId}`),
};

export const auditProvider: AuditProvider = {
  async listEvents(limit = 100) {
    return sortAuditEvents(await api<AuditEvent[]>("/api/audit"), limit);
  },
  record: (event) => post("/api/audit", event),
};

export const integrationProvider: IntegrationProvider = {
  listIntegrations: () => api<Integration[]>("/api/integrations"),
};
