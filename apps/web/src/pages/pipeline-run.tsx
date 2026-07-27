import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ExternalLink,
  FileCode2,
  GitPullRequest,
  RotateCcw,
  Workflow,
} from "lucide-react";
import type { PipelineStage } from "@secureflow/types";
import { PageHeader } from "@/components/domain/page-header";
import { PipelineFlow } from "@/components/domain/pipeline-flow";
import { ApprovalPanel } from "@/components/domain/approval-panel";
import { AIPanel, RiskScoreIndicator } from "@/components/domain/ai-panel";
import { GateBadge, SeverityBadge, StageStatusBadge, StatusBadge } from "@/components/domain/badges";
import { LogViewer } from "@/components/domain/log-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Skeleton, Tooltip } from "@/components/ui/misc";
import { mockState } from "@/lib/providers";
import {
  useDeploymentRisk,
  usePlans,
  useRetryStage,
  useRun,
  useRunSummary,
  useStageLogs,
} from "@/lib/queries";
import { formatDateTime, formatDuration, shortSha, titleCase } from "@/lib/utils";
import { useCan } from "@/stores/session";
import { toast } from "sonner";
import { applications } from "@secureflow/mock-data";

export default function PipelineRunPage() {
  const { runId = "" } = useParams();
  const { data: run, isLoading } = useRun(runId);
  const { data: summary, isLoading: aiLoading } = useRunSummary(runId);
  const { data: risk } = useDeploymentRisk(runId);
  const { data: plans } = usePlans(run?.applicationId);
  const retry = useRetryStage(runId);
  const canRetry = useCan("pipeline.retry-stage");
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);

  const selectedStage: PipelineStage | null = useMemo(
    () => run?.stages.find((s) => s.id === selectedStageId) ?? null,
    [run, selectedStageId],
  );
  const { data: logs } = useStageLogs(
    runId,
    selectedStage?.id ?? null,
    selectedStage?.status === "running",
  );

  const approvals = mockState.approvals.filter((a) => a.runId === runId);
  const relatedPlan = plans?.find((p) => p.pipelineRunId === runId);
  const app = applications.find((a) => a.id === run?.applicationId);

  if (isLoading || !run) {
    return (
      <div className="mx-auto max-w-[1500px] space-y-4 p-6">
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-[560px]" />
      </div>
    );
  }

  const riskScore = risk
    ? Number(/\d+/.exec(risk.title)?.[0] ?? 20)
    : undefined;

  const timeline = run.stages
    .filter((s) => s.startedAt && (s.phase === "deploy" || s.phase === "verify"))
    .map((s) => ({ at: s.startedAt!, label: `${s.name} — ${titleCase(s.status)}` }));

  const externalAction = (label: string) =>
    toast.info(`${label} (simulated)`, {
      description: "In production this opens the connected system in a new tab.",
    });

  return (
    <div className="mx-auto max-w-[1500px] p-6 rise-in">
      <Link to="/pipelines" className="mb-3 inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg">
        <ArrowLeft size={13} aria-hidden /> All pipeline runs
      </Link>
      <PageHeader
        title={`${run.id} — ${app?.name ?? run.applicationId}`}
        subtitle={run.commit.message}
        actions={
          <>
            <StatusBadge status={run.status} />
            <GateBadge gate={run.securityGate} />
            {run.commit.pullRequest && (
              <Button variant="outline" size="sm" onClick={() => externalAction(`Open PR #${run.commit.pullRequest?.number}`)}>
                <GitPullRequest size={13} /> PR #{run.commit.pullRequest.number}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => externalAction("Open Argo CD application")}>
              <Workflow size={13} /> Argo CD
            </Button>
            {relatedPlan && (
              <Link to={`/infrastructure?plan=${relatedPlan.id}`}>
                <Button variant="outline" size="sm">
                  <FileCode2 size={13} /> Terraform plan
                </Button>
              </Link>
            )}
          </>
        }
      />

      {/* Commit / artifact facts */}
      <Card className="mb-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 p-4 text-xs sm:grid-cols-3 lg:grid-cols-6">
          <div><dt className="text-fg-faint">Branch</dt><dd className="mt-0.5 font-mono text-fg">{run.commit.branch}</dd></div>
          <div><dt className="text-fg-faint">Commit</dt><dd className="mt-0.5 font-mono text-fg">{shortSha(run.commit.sha)}</dd></div>
          <div><dt className="text-fg-faint">Author</dt><dd className="mt-0.5 text-fg">{run.commit.author}</dd></div>
          <div><dt className="text-fg-faint">Trigger</dt><dd className="mt-0.5 text-fg">{titleCase(run.trigger)}</dd></div>
          <div><dt className="text-fg-faint">Artifact</dt><dd className="mt-0.5 font-mono text-fg">{run.artifactVersion}</dd></div>
          <div><dt className="text-fg-faint">Environment</dt><dd className="mt-0.5 text-fg">{titleCase(run.environment)}</dd></div>
          <div><dt className="text-fg-faint">Started</dt><dd className="mt-0.5 text-fg">{formatDateTime(run.startedAt)}</dd></div>
          <div><dt className="text-fg-faint">Finished</dt><dd className="mt-0.5 text-fg">{formatDateTime(run.finishedAt)}</dd></div>
          <div><dt className="text-fg-faint">Duration</dt><dd className="mt-0.5 font-mono text-fg">{formatDuration(run.durationSeconds)}</dd></div>
          {run.commit.pullRequest && (
            <div className="col-span-2 lg:col-span-3">
              <dt className="text-fg-faint">Pull request</dt>
              <dd className="mt-0.5 truncate text-fg">#{run.commit.pullRequest.number} — {run.commit.pullRequest.title}</dd>
            </div>
          )}
        </dl>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4 min-w-0">
          <PipelineFlow
            stages={run.stages}
            selectedStageId={selectedStageId}
            onSelect={setSelectedStageId}
          />

          {/* Stage inspector */}
          {selectedStage ? (
            <Card>
              <CardHeader
                title={selectedStage.name}
                subtitle={`${selectedStage.tool} · owner ${selectedStage.owner} · ${selectedStage.blocksDeployment ? "blocks deployment on failure" : "non-blocking"}`}
                actions={
                  <>
                    <StageStatusBadge status={selectedStage.status} />
                    {selectedStage.canRetry && (
                      <Tooltip label={canRetry ? "Re-queue this stage" : "Your current role cannot retry stages (RBAC)."}>
                        <span tabIndex={0}>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={!canRetry || retry.isPending}
                            onClick={() => retry.mutate(selectedStage.id)}
                          >
                            <RotateCcw size={13} /> Retry
                          </Button>
                        </span>
                      </Tooltip>
                    )}
                  </>
                }
              />
              <CardBody className="space-y-4">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
                  <div><dt className="text-fg-faint">Started</dt><dd className="mt-0.5 text-fg">{formatDateTime(selectedStage.startedAt)}</dd></div>
                  <div><dt className="text-fg-faint">Finished</dt><dd className="mt-0.5 text-fg">{formatDateTime(selectedStage.finishedAt)}</dd></div>
                  <div><dt className="text-fg-faint">Duration</dt><dd className="mt-0.5 font-mono text-fg">{formatDuration(selectedStage.durationSeconds)}</dd></div>
                  <div><dt className="text-fg-faint">Evidence</dt><dd className="mt-0.5 font-mono text-fg">{selectedStage.evidenceIds.length > 0 ? selectedStage.evidenceIds.join(", ") : "—"}</dd></div>
                </dl>

                {selectedStage.failureReason && (
                  <div className="rounded-md border border-danger/40 bg-danger/8 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-danger">Failure reason</p>
                    <p className="mt-1 text-sm text-fg">{selectedStage.failureReason}</p>
                    {selectedStage.remediation && (
                      <>
                        <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-accent">Remediation recommendation</p>
                        <p className="mt-1 text-sm text-fg-muted">{selectedStage.remediation}</p>
                      </>
                    )}
                  </div>
                )}

                {selectedStage.findings.length > 0 && (
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">Findings raised by this stage</p>
                    <ul className="space-y-1.5">
                      {selectedStage.findings.map((f) => (
                        <li key={f.findingId}>
                          <Link
                            to={`/security?finding=${f.findingId}`}
                            className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 transition-colors hover:border-line-strong"
                          >
                            <SeverityBadge severity={f.severity} />
                            <span className="truncate text-sm text-fg">{f.title}</span>
                            <ExternalLink size={12} className="ml-auto shrink-0 text-fg-faint" aria-hidden />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">
                    Logs {selectedStage.status === "running" && <span className="text-info">(streaming)</span>}
                  </p>
                  <LogViewer lines={logs ?? []} follow={selectedStage.status === "running"} />
                </div>
              </CardBody>
            </Card>
          ) : (
            <EmptyState
              title="Select a pipeline stage"
              hint="Click any node in the graph to inspect its status, logs, findings, evidence, and retry options."
            />
          )}
        </div>

        <div className="space-y-4">
          {riskScore !== undefined && (
            <Card className="p-4">
              <RiskScoreIndicator score={riskScore} label={risk?.summary} />
            </Card>
          )}
          <ApprovalPanel run={run} approvals={approvals} />
          <AIPanel recommendation={summary} loading={aiLoading} />

          {relatedPlan && (
            <Card>
              <CardHeader title="Infrastructure changes" subtitle={`Plan ${relatedPlan.id}`} />
              <CardBody className="text-sm text-fg-muted">
                <p>
                  <span className="font-mono text-ok">+{relatedPlan.summary.add}</span>{" "}
                  <span className="font-mono text-warn">~{relatedPlan.summary.change}</span>{" "}
                  <span className="font-mono text-danger">-{relatedPlan.summary.destroy}</span>
                  {" · "}cost Δ{" "}
                  <span className="font-mono">{relatedPlan.costDeltaUsd >= 0 ? "+" : ""}${relatedPlan.costDeltaUsd}/mo</span>
                </p>
                <Link to={`/infrastructure?plan=${relatedPlan.id}`} className="mt-2 inline-block text-xs text-accent hover:underline">
                  Review full plan →
                </Link>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Deployment timeline" />
            {timeline.length === 0 ? (
              <CardBody><p className="text-sm text-fg-faint">No deployment events yet for this run.</p></CardBody>
            ) : (
              <ol className="space-y-0 p-4">
                {timeline.map((t, i) => (
                  <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                    {i < timeline.length - 1 && (
                      <span className="absolute left-[5px] top-3.5 h-full w-px bg-line" aria-hidden />
                    )}
                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-accent bg-surface" aria-hidden />
                    <div>
                      <p className="text-sm text-fg">{t.label}</p>
                      <p className="text-[11px] text-fg-faint">{formatDateTime(t.at)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card>
            <CardHeader title="Evidence bundle" />
            <ul className="divide-y divide-line/60 text-xs">
              {run.stages.filter((s) => s.evidenceIds.length > 0).slice(0, 8).map((s) => (
                <li key={s.id} className="flex items-center gap-2 px-4 py-2">
                  <Badge color="var(--accent)">sealed</Badge>
                  <span className="truncate font-mono text-fg-muted">{s.evidenceIds[0]}</span>
                </li>
              ))}
              {run.stages.every((s) => s.evidenceIds.length === 0) && (
                <li className="px-4 py-3 text-fg-faint">Evidence is sealed as gates complete.</li>
              )}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
