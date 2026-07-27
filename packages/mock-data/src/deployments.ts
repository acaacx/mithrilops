import type { Deployment } from "@secureflow/types";

const now = Date.now();
const hoursAgo = (n: number) => new Date(now - n * 3_600_000).toISOString();

export const deployments: Deployment[] = [
  // Payments API
  { id: "dep-pay-dev", applicationId: "app-payments", environment: "development", version: "v2.15.0-rc.2", previousVersion: "v2.15.0-rc.1", status: "healthy", strategy: "rolling", argoSyncStatus: "synced", securityGate: "passed", deployedAt: hoursAgo(5), deployedBy: "pipeline run-1482", pipelineRunId: "run-1482" },
  { id: "dep-pay-test", applicationId: "app-payments", environment: "test", version: "v2.15.0-rc.2", previousVersion: "v2.14.3", status: "healthy", strategy: "rolling", argoSyncStatus: "synced", securityGate: "passed", deployedAt: hoursAgo(4), deployedBy: "pipeline run-1482", pipelineRunId: "run-1482" },
  { id: "dep-pay-stg", applicationId: "app-payments", environment: "staging", version: "v2.15.0-rc.2", previousVersion: "v2.14.3", status: "healthy", strategy: "blue-green", argoSyncStatus: "synced", securityGate: "passed", deployedAt: hoursAgo(3), deployedBy: "pipeline run-1482", pipelineRunId: "run-1482" },
  { id: "dep-pay-prod", applicationId: "app-payments", environment: "production", version: "v2.14.3", previousVersion: "v2.14.2", status: "healthy", strategy: "canary", argoSyncStatus: "synced", securityGate: "passed", deployedAt: hoursAgo(29), deployedBy: "Elin Sørensen", pipelineRunId: "run-1481" },

  // Customer Portal
  { id: "dep-por-dev", applicationId: "app-portal", environment: "development", version: "v5.9.0-beta.1", previousVersion: "v5.9.0-beta.0", status: "healthy", strategy: "rolling", argoSyncStatus: "synced", securityGate: "failed", deployedAt: hoursAgo(8), deployedBy: "pipeline run-2210", pipelineRunId: "run-2210" },
  { id: "dep-por-test", applicationId: "app-portal", environment: "test", version: "v5.8.0", status: "healthy", strategy: "rolling", argoSyncStatus: "synced", securityGate: "passed", deployedAt: hoursAgo(54), deployedBy: "pipeline run-2208", pipelineRunId: "run-2208" },
  { id: "dep-por-stg", applicationId: "app-portal", environment: "staging", version: "v5.8.0", status: "degraded", strategy: "blue-green", argoSyncStatus: "out-of-sync", securityGate: "passed", deployedAt: hoursAgo(53), deployedBy: "pipeline run-2208", pipelineRunId: "run-2208" },
  { id: "dep-por-prod", applicationId: "app-portal", environment: "production", version: "v5.8.0", previousVersion: "v5.7.2", status: "degraded", strategy: "canary", argoSyncStatus: "synced", securityGate: "passed", deployedAt: hoursAgo(30), deployedBy: "Elin Sørensen", pipelineRunId: "run-2208" },

  // Identity Service
  { id: "dep-idn-dev", applicationId: "app-identity", environment: "development", version: "v3.2.1", status: "healthy", strategy: "rolling", argoSyncStatus: "synced", securityGate: "passed", deployedAt: hoursAgo(54), deployedBy: "pipeline run-0864", pipelineRunId: "run-0864" },
  { id: "dep-idn-test", applicationId: "app-identity", environment: "test", version: "v3.2.1", status: "healthy", strategy: "rolling", argoSyncStatus: "synced", securityGate: "passed", deployedAt: hoursAgo(53), deployedBy: "pipeline run-0864", pipelineRunId: "run-0864" },
  { id: "dep-idn-stg", applicationId: "app-identity", environment: "staging", version: "v3.2.1", status: "healthy", strategy: "blue-green", argoSyncStatus: "synced", securityGate: "passed", deployedAt: hoursAgo(53), deployedBy: "pipeline run-0864", pipelineRunId: "run-0864" },
  { id: "dep-idn-prod", applicationId: "app-identity", environment: "production", version: "v3.2.1", previousVersion: "v3.2.0", status: "healthy", strategy: "blue-green", argoSyncStatus: "synced", securityGate: "passed", deployedAt: hoursAgo(52), deployedBy: "Elin Sørensen", pipelineRunId: "run-0864" },

  // Notification Worker
  { id: "dep-not-dev", applicationId: "app-notify", environment: "development", version: "v1.10.0-rc.1", previousVersion: "v1.9.7", status: "progressing", strategy: "rolling", argoSyncStatus: "syncing", securityGate: "passed", deployedAt: hoursAgo(0.3), deployedBy: "pipeline run-0512", pipelineRunId: "run-0512" },
  { id: "dep-not-test", applicationId: "app-notify", environment: "test", version: "v1.9.7", status: "healthy", strategy: "rolling", argoSyncStatus: "synced", securityGate: "passed", deployedAt: hoursAgo(28), deployedBy: "pipeline run-0511", pipelineRunId: "run-0511" },
  { id: "dep-not-stg", applicationId: "app-notify", environment: "staging", version: "v1.9.7", status: "healthy", strategy: "rolling", argoSyncStatus: "synced", securityGate: "passed", deployedAt: hoursAgo(27), deployedBy: "pipeline run-0511", pipelineRunId: "run-0511" },
  { id: "dep-not-prod", applicationId: "app-notify", environment: "production", version: "v1.9.7", previousVersion: "v1.9.6", status: "healthy", strategy: "rolling", argoSyncStatus: "synced", securityGate: "passed", deployedAt: hoursAgo(26), deployedBy: "Elin Sørensen", pipelineRunId: "run-0511" },

  // Reporting Platform
  { id: "dep-rep-dev", applicationId: "app-reporting", environment: "development", version: "v4.2.1-dev", status: "healthy", strategy: "rolling", argoSyncStatus: "synced", securityGate: "passed", deployedAt: hoursAgo(6), deployedBy: "pipeline run-0714" },
  { id: "dep-rep-test", applicationId: "app-reporting", environment: "test", version: "v4.2.0", status: "healthy", strategy: "rolling", argoSyncStatus: "synced", securityGate: "passed", deployedAt: hoursAgo(14), deployedBy: "pipeline run-0713", pipelineRunId: "run-0713" },
  { id: "dep-rep-stg", applicationId: "app-reporting", environment: "staging", version: "v4.2.0", status: "healthy", strategy: "canary", argoSyncStatus: "synced", securityGate: "passed", deployedAt: hoursAgo(13), deployedBy: "pipeline run-0713", pipelineRunId: "run-0713" },
  { id: "dep-rep-prod", applicationId: "app-reporting", environment: "production", version: "v4.1.0", previousVersion: "v4.2.0", status: "rolled-back", strategy: "canary", argoSyncStatus: "synced", securityGate: "passed", deployedAt: hoursAgo(11), deployedBy: "auto-rollback (SLO breach)", canaryPercent: 50, pipelineRunId: "run-0713" },
];
