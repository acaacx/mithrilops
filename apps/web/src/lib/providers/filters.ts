import type {
  AuditEvent,
  FindingFilters,
  PipelineRun,
  PipelineRunFilters,
  SecurityFinding,
} from "@secureflow/types";

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, informational: 4 } as const;

export function filterAndSortRuns(
  runs: PipelineRun[],
  filters?: PipelineRunFilters,
): PipelineRun[] {
  let result = [...runs].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
  if (filters?.applicationId) result = result.filter((r) => r.applicationId === filters.applicationId);
  if (filters?.status) result = result.filter((r) => r.status === filters.status);
  if (filters?.environment) result = result.filter((r) => r.environment === filters.environment);
  if (filters?.branch) result = result.filter((r) => r.commit.branch === filters.branch);
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.commit.message.toLowerCase().includes(q) ||
        r.commit.branch.toLowerCase().includes(q) ||
        r.commit.author.toLowerCase().includes(q) ||
        r.commit.sha.startsWith(q),
    );
  }
  return result;
}

export function filterAndSortFindings(
  findings: SecurityFinding[],
  filters?: FindingFilters,
): SecurityFinding[] {
  let result = [...findings];
  if (filters?.applicationId) result = result.filter((f) => f.applicationId === filters.applicationId);
  if (filters?.repositoryId) result = result.filter((f) => f.repositoryId === filters.repositoryId);
  if (filters?.branch) result = result.filter((f) => f.branch === filters.branch);
  if (filters?.environment) result = result.filter((f) => f.environment === filters.environment);
  if (filters?.scanner) result = result.filter((f) => f.scanner === filters.scanner);
  if (filters?.type) result = result.filter((f) => f.type === filters.type);
  if (filters?.severity) result = result.filter((f) => f.severity === filters.severity);
  if (filters?.status) result = result.filter((f) => f.status === filters.status);
  if (filters?.ownerUserId) result = result.filter((f) => f.ownerUserId === filters.ownerUserId);
  if (filters?.pipelineRunId) result = result.filter((f) => f.pipelineRunId === filters.pipelineRunId);
  if (filters?.frameworkId)
    result = result.filter((f) =>
      f.complianceMappings.some((m) => m.frameworkId === filters.frameworkId),
    );
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (f) =>
        f.title.toLowerCase().includes(q) ||
        f.ruleId.toLowerCase().includes(q) ||
        (f.cve ?? "").toLowerCase().includes(q) ||
        f.affectedResource.toLowerCase().includes(q),
    );
  }
  return result.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function sortAuditEvents(events: AuditEvent[], limit = 100): AuditEvent[] {
  return [...events]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}
