import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mockState } from "@/lib/providers/mock-state";
import { useNotifications } from "@/stores/notifications";

const SIMULATED_RUN_ID = "run-0512";
const TICK_MS = 7000;
/** Stage index the demo loop resets to after a completed cycle. */
const RESET_INDEX = 11;

let idleTicks = 0;

/**
 * Advances the designated "running" pipeline one stage per tick so the UI feels
 * live: stages transition pending → running → succeeded, logs stream (via
 * polling), notifications fire, and dashboards update. Pure simulation — a real
 * deployment would receive these events over WebSocket/SSE from the API.
 */
export function startPipelineSimulator(queryClient: QueryClient): () => void {
  const interval = setInterval(() => tick(queryClient), TICK_MS);
  return () => clearInterval(interval);
}

export function tick(queryClient: QueryClient): void {
  const run = mockState.runs.find((r) => r.id === SIMULATED_RUN_ID);
  if (!run) return;

  if (run.status === "succeeded") {
    // Idle a few ticks, then restart the loop so the demo stays alive.
    if (++idleTicks < 5) return;
    idleTicks = 0;
    run.status = "running";
    run.securityGate = "in-progress";
    run.finishedAt = undefined;
    run.durationSeconds = undefined;
    run.startedAt = new Date().toISOString();
    for (let i = RESET_INDEX; i < run.stages.length; i++) {
      const stage = run.stages[i];
      if (!stage) continue;
      stage.status = "pending";
      stage.startedAt = undefined;
      stage.finishedAt = undefined;
      stage.durationSeconds = undefined;
      stage.findings = [];
    }
    const first = run.stages[RESET_INDEX];
    if (first) {
      first.status = "running";
      first.startedAt = new Date().toISOString();
    }
    notify(queryClient, {
      title: "Pipeline started",
      body: `notification-worker ${run.artifactVersion} — new execution began.`,
      kind: "info",
    });
    invalidate(queryClient);
    return;
  }

  if (run.status !== "running") return;

  const idx = run.stages.findIndex((s) => s.status === "running");
  if (idx === -1) return;
  const current = run.stages[idx];
  if (!current) return;

  // Complete the current stage.
  current.status = "succeeded";
  current.finishedAt = new Date().toISOString();
  current.durationSeconds = Math.round(
    (Date.now() - new Date(current.startedAt ?? Date.now()).getTime()) / 1000,
  );
  if (current.blocksDeployment) current.evidenceIds = [`ev-${run.id}-${current.definitionId}`];

  // Security finding appears mid-run at the image scan, then gets waived as non-blocking.
  if (current.definitionId === "image-scan" && current.findings.length === 0) {
    current.findings = [
      {
        findingId: "find-missing-limits",
        severity: "medium",
        title: "Base image: 2 medium CVEs (below gate threshold)",
      },
    ];
    notify(queryClient, {
      title: "Findings detected during scan",
      body: "Trivy reported 2 medium CVEs in notification-worker — below the blocking threshold.",
      kind: "warning",
    });
  }

  if (current.definitionId === "argo-sync") {
    const dep = mockState.deployments.find((d) => d.id === "dep-not-dev");
    if (dep) {
      dep.argoSyncStatus = "synced";
      dep.status = "healthy";
      dep.version = run.artifactVersion;
    }
  }

  // Advance to the next runnable stage (dev-loop demo skips prod-only stages).
  const stopAfter = "smoke-tests";
  if (current.definitionId === stopAfter) {
    run.status = "succeeded";
    run.securityGate = "passed";
    run.finishedAt = new Date().toISOString();
    run.durationSeconds = Math.round(
      (Date.now() - new Date(run.startedAt).getTime()) / 1000,
    );
    for (const s of run.stages) {
      if (s.status === "pending") s.status = "skipped";
    }
    notify(queryClient, {
      title: "Pipeline succeeded",
      body: `notification-worker ${run.artifactVersion} verified in development.`,
      kind: "success",
    });
    invalidate(queryClient);
    return;
  }

  const next = run.stages[idx + 1];
  if (next) {
    next.status = "running";
    next.startedAt = new Date().toISOString();
    if (next.definitionId === "manual-approval" || next.definitionId === "prod-approval") {
      // Dev-loop run: approvals auto-pass as not-required for development scope.
      next.status = "succeeded";
      next.finishedAt = new Date().toISOString();
      next.durationSeconds = 1;
      const after = run.stages[idx + 2];
      if (after) {
        after.status = "running";
        after.startedAt = new Date().toISOString();
      }
    }
  }

  invalidate(queryClient);
}

function notify(
  queryClient: QueryClient,
  n: { title: string; body: string; kind: "info" | "success" | "warning" | "error" },
): void {
  useNotifications.getState().push(n);
  const fn = n.kind === "success" ? toast.success : n.kind === "warning" ? toast.warning : n.kind === "error" ? toast.error : toast.info;
  fn(n.title, { description: n.body });
  invalidate(queryClient);
}

function invalidate(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["runs"] });
  void queryClient.invalidateQueries({ queryKey: ["run", SIMULATED_RUN_ID] });
  void queryClient.invalidateQueries({ queryKey: ["deployments"] });
  void queryClient.invalidateQueries({ queryKey: ["applications"] });
}
