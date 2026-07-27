import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApprovalRequest,
  EnvironmentName,
  FindingFilters,
  FindingStatus,
  FrameworkId,
  GeneratorRequest,
  PipelineRunFilters,
} from "@secureflow/types";
import { toast } from "sonner";
import {
  architectureProvider,
  auditProvider,
  complianceProvider,
  deploymentProvider,
  infrastructureProvider,
  integrationProvider,
  pipelineProvider,
  securityProvider,
} from "@/lib/providers";
import { aiService } from "@/lib/ai/ai-service";

export function useApplications() {
  return useQuery({ queryKey: ["applications"], queryFn: () => deploymentProvider.listApplications() });
}

export function useApplication(appId: string) {
  return useQuery({
    queryKey: ["applications", appId],
    queryFn: () => deploymentProvider.getApplication(appId),
  });
}

export function useRuns(filters?: PipelineRunFilters) {
  return useQuery({
    queryKey: ["runs", filters ?? {}],
    queryFn: () => pipelineProvider.listRuns(filters),
    staleTime: 3000,
  });
}

export function useRun(runId: string) {
  return useQuery({
    queryKey: ["run", runId],
    queryFn: () => pipelineProvider.getRun(runId),
    staleTime: 2000,
  });
}

export function useStageLogs(runId: string, stageId: string | null, live: boolean) {
  return useQuery({
    queryKey: ["logs", runId, stageId],
    queryFn: () => pipelineProvider.getStageLogs(runId, stageId ?? ""),
    enabled: stageId !== null,
    refetchInterval: live ? 4000 : false,
  });
}

export function useFindings(filters?: FindingFilters) {
  return useQuery({
    queryKey: ["findings", filters ?? {}],
    queryFn: () => securityProvider.listFindings(filters),
  });
}

export function useDeployments(applicationId?: string) {
  return useQuery({
    queryKey: ["deployments", applicationId ?? "all"],
    queryFn: () => deploymentProvider.listDeployments(applicationId),
    staleTime: 3000,
  });
}

export function usePlans(applicationId?: string) {
  return useQuery({
    queryKey: ["plans", applicationId ?? "all"],
    queryFn: () => infrastructureProvider.listPlans(applicationId),
  });
}

export function useFrameworks() {
  return useQuery({ queryKey: ["frameworks"], queryFn: () => complianceProvider.listFrameworks() });
}

export function useFramework(frameworkId: FrameworkId) {
  return useQuery({
    queryKey: ["frameworks", frameworkId],
    queryFn: () => complianceProvider.getFramework(frameworkId),
  });
}

export function useArchitecture(applicationId: string) {
  return useQuery({
    queryKey: ["architecture", applicationId],
    queryFn: () => architectureProvider.getDiagram(applicationId),
  });
}

export function useAuditEvents() {
  return useQuery({ queryKey: ["audit"], queryFn: () => auditProvider.listEvents(), staleTime: 2000 });
}

export function useIntegrations() {
  return useQuery({ queryKey: ["integrations"], queryFn: () => integrationProvider.listIntegrations() });
}

export function useRunSummary(runId: string) {
  return useQuery({
    queryKey: ["ai", "run-summary", runId],
    queryFn: () => aiService.summarizeRun(runId),
    staleTime: 60_000,
  });
}

export function useDeploymentRisk(runId: string) {
  return useQuery({
    queryKey: ["ai", "risk", runId],
    queryFn: () => aiService.scoreDeploymentRisk(runId),
    staleTime: 60_000,
  });
}

export function useExecutiveSummary() {
  return useQuery({
    queryKey: ["ai", "executive"],
    queryFn: () => aiService.executiveSummary(),
    staleTime: 5 * 60_000,
  });
}

export function useFindingExplanation(findingId: string | null) {
  return useQuery({
    queryKey: ["ai", "finding", findingId],
    queryFn: () => aiService.explainFinding(findingId ?? ""),
    enabled: findingId !== null,
    staleTime: 5 * 60_000,
  });
}

export function usePlanSummary(planId: string | null) {
  return useQuery({
    queryKey: ["ai", "plan", planId],
    queryFn: () => aiService.summarizeTerraformPlan(planId ?? ""),
    enabled: planId !== null,
    staleTime: 5 * 60_000,
  });
}

function invalidateRunData(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["runs"] });
  void qc.invalidateQueries({ queryKey: ["run"] });
  void qc.invalidateQueries({ queryKey: ["audit"] });
}

export function useApproveDeployment(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (approval: ApprovalRequest) => pipelineProvider.approveDeployment(runId, approval),
    onSuccess: (_d, approval) => {
      invalidateRunData(qc);
      toast.success(`Deployment ${approval.decision.replace("-", " ")}`, {
        description: `Decision recorded for ${runId} with audit trail.`,
      });
    },
    // Error toast is handled globally by the MutationCache in App.tsx
    // (avoids double-toasting on failure).
  });
}

export function useRetryStage(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stageId: string) => pipelineProvider.retryStage(runId, stageId),
    onSuccess: () => {
      invalidateRunData(qc);
      toast.info("Stage retry queued", { description: "The stage was re-queued for execution." });
    },
  });
}

export function useUpdateFindingStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId, status, reason }: { findingId: string; status: FindingStatus; reason?: string }) =>
      securityProvider.updateFindingStatus(findingId, status, reason),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ["findings"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
      toast.success("Finding updated", { description: `Status changed to ${vars.status}.` });
    },
  });
}

export function usePromote(applicationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (env: EnvironmentName) => deploymentProvider.promote(applicationId, env),
    onSuccess: (_d, env) => {
      void qc.invalidateQueries({ queryKey: ["deployments"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
      toast.success("Promotion started", { description: `Release promoting to ${env}.` });
    },
  });
}

export function useRollback(applicationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (revision: string) => deploymentProvider.rollback(applicationId, revision),
    onSuccess: (_d, revision) => {
      void qc.invalidateQueries({ queryKey: ["deployments"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
      toast.warning("Rollback executed", { description: `Production restored to ${revision}.` });
    },
  });
}

export function useSyncApplication(applicationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deploymentProvider.syncApplication(applicationId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["deployments"] });
      toast.success("Argo CD sync triggered");
    },
  });
}

export function useGeneratePipeline() {
  return useMutation({
    mutationFn: (request: GeneratorRequest) => aiService.generatePipeline(request),
  });
}
