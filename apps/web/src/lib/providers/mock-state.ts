import {
  applications,
  approvals,
  architectureDiagrams,
  auditEvents,
  complianceFrameworks,
  deployments,
  infrastructurePlans,
  integrations,
  pipelineRuns,
  securityFindings,
} from "@secureflow/mock-data";
import type {
  Application,
  Approval,
  ArchitectureDiagram,
  AuditEvent,
  ComplianceFramework,
  Deployment,
  InfrastructurePlan,
  Integration,
  PipelineRun,
  SecurityFinding,
} from "@secureflow/types";

/**
 * Mutable in-memory copy of the seed data. Mock providers read and mutate this
 * so approvals, retries, and rollbacks behave statefully within a session.
 */
interface MockState {
  applications: Application[];
  runs: PipelineRun[];
  approvals: Approval[];
  findings: SecurityFinding[];
  frameworks: ComplianceFramework[];
  plans: InfrastructurePlan[];
  deployments: Deployment[];
  audit: AuditEvent[];
  integrations: Integration[];
  diagrams: ArchitectureDiagram[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export const mockState: MockState = {
  applications: clone(applications),
  runs: clone(pipelineRuns),
  approvals: clone(approvals),
  findings: clone(securityFindings),
  frameworks: clone(complianceFrameworks),
  plans: clone(infrastructurePlans),
  deployments: clone(deployments),
  audit: clone(auditEvents),
  integrations: clone(integrations),
  diagrams: clone(architectureDiagrams),
};

/** Simulated network latency so loading states are visible and realistic. */
export function delay<T>(value: T, ms = 220): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

let auditCounter = 100;
export function nextAuditId(): string {
  return `aud-${++auditCounter}`;
}
