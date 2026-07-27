import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, FileCheck2 } from "lucide-react";
import type { ComplianceControl, FrameworkId } from "@secureflow/types";
import { complianceEvidence, riskExceptions, userById } from "@secureflow/mock-data";
import { STAGE_DEFINITIONS } from "@secureflow/mock-data";
import { PageHeader } from "@/components/domain/page-header";
import { MetricCard } from "@/components/domain/metric-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton, Tooltip } from "@/components/ui/misc";
import { useFrameworks } from "@/lib/queries";
import { cn, formatDateTime, titleCase } from "@/lib/utils";
import { useCan } from "@/stores/session";
import { toast } from "sonner";

const CONTROL_COLORS: Record<ComplianceControl["status"], string> = {
  passed: "var(--ok)",
  failed: "var(--danger)",
  "needs-evidence": "var(--warn)",
  exception: "var(--blocked)",
  "not-applicable": "var(--pending)",
};

export default function CompliancePage() {
  const { data: frameworks, isLoading } = useFrameworks();
  const [selectedId, setSelectedId] = useState<FrameworkId | null>(null);
  const canDownload = useCan("evidence.download");
  const selected = frameworks?.find((f) => f.id === selectedId) ?? null;

  const stats = useMemo(() => {
    const controls = (frameworks ?? []).flatMap((f) => f.controls);
    const passed = controls.filter((c) => c.status === "passed").length;
    const failed = controls.filter((c) => c.status === "failed").length;
    const needsEvidence = controls.filter((c) => c.status === "needs-evidence").length;
    const exceptions = controls.filter((c) => c.status === "exception").length;
    const score = controls.length ? Math.round((passed / controls.length) * 100) : 0;
    return { passed, failed, needsEvidence, exceptions, score };
  }, [frameworks]);

  const download = (what: string) => {
    if (!canDownload) return;
    toast.success("Evidence package prepared (simulated)", {
      description: `${what} exported with SHA-256 manifest for auditors.`,
    });
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1500px] space-y-4 p-6">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] p-6 rise-in">
      <PageHeader
        title="Compliance center"
        subtitle="Framework coverage, control status, and audit-ready evidence"
        actions={
          <Tooltip label={canDownload ? "Export the full audit evidence package" : "Requires evidence.download (RBAC)"}>
            <span tabIndex={0}>
              <Button variant="primary" disabled={!canDownload} onClick={() => download("Full audit package")}>
                <Download size={14} /> Audit evidence package
              </Button>
            </span>
          </Tooltip>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Overall compliance" value={`${stats.score}%`} accent="var(--accent)" />
        <MetricCard label="Controls passed" value={stats.passed} accent="var(--ok)" />
        <MetricCard label="Controls failed" value={stats.failed} accent="var(--danger)" />
        <MetricCard label="Needing evidence" value={stats.needsEvidence} accent="var(--warn)" />
        <MetricCard
          label="Exceptions"
          value={stats.exceptions}
          trend="flat"
          trendLabel={`${riskExceptions.length} expiring within 60d`}
          accent="var(--blocked)"
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[340px_1fr]">
        <div className="space-y-2">
          {(frameworks ?? []).map((fw) => {
            const failed = fw.controls.filter((c) => c.status === "failed").length;
            return (
              <button
                key={fw.id}
                onClick={() => setSelectedId(fw.id)}
                className={cn(
                  "w-full rounded-lg border p-3 text-left transition-colors cursor-pointer",
                  fw.id === selectedId ? "border-accent bg-accent/10" : "border-line bg-surface hover:border-line-strong",
                )}
                aria-pressed={fw.id === selectedId}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-fg">{fw.name}</p>
                  <span className="font-mono text-xs text-fg-muted">{fw.coveragePercent}%</span>
                </div>
                <p className="mt-0.5 text-[11px] text-fg-faint">
                  v{fw.version} · {fw.controls.length} tracked controls
                  {failed > 0 && <span className="ml-1 text-danger">· {failed} failing</span>}
                </p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${fw.coveragePercent}%` }} />
                </div>
              </button>
            );
          })}
        </div>

        <div>
          {selected ? (
            <Card>
              <CardHeader
                title={`${selected.name} — controls`}
                subtitle={`Coverage ${selected.coveragePercent}% · version ${selected.version}`}
                actions={
                  <Button size="sm" variant="secondary" disabled={!canDownload} onClick={() => download(`${selected.name} evidence`)}>
                    <Download size={13} /> Export
                  </Button>
                }
              />
              <ul className="divide-y divide-line/60">
                {selected.controls.map((c) => (
                  <li key={c.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-fg-faint">{c.controlId}</span>
                      <p className="text-sm font-medium text-fg">{c.title}</p>
                      <Badge color={CONTROL_COLORS[c.status]} className="ml-auto">{titleCase(c.status)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-fg-muted">{c.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-faint">
                      <span>Owner: {userById(c.ownerUserId).name}</span>
                      <span>Validated {formatDateTime(c.lastValidatedAt)}</span>
                      <span>Next review {formatDateTime(c.nextReviewAt)}</span>
                      {c.relatedStageDefinitionId && (
                        <span className="inline-flex items-center gap-1">
                          <FileCheck2 size={11} aria-hidden />
                          Pipeline stage: {STAGE_DEFINITIONS.find((s) => s.id === c.relatedStageDefinitionId)?.name}
                        </span>
                      )}
                    </div>
                    {(c.evidenceIds.length > 0 || c.relatedFindingIds.length > 0) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {c.evidenceIds.map((id) => {
                          const ev = complianceEvidence.find((e) => e.id === id);
                          return (
                            <Tooltip key={id} label={ev ? `${ev.source} · sha256:${ev.sha256.slice(0, 16)}…` : id}>
                              <span>
                                <Badge color="var(--accent)">{ev?.name ?? id}</Badge>
                              </span>
                            </Tooltip>
                          );
                        })}
                        {c.relatedFindingIds.map((id) => (
                          <Link key={id} to={`/security?finding=${id}`}>
                            <Badge color="var(--warn)">finding: {id.replace("find-", "")}</Badge>
                          </Link>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <Card className="flex min-h-64 items-center justify-center p-8 text-center text-sm text-fg-faint">
              Select a framework to inspect its controls, evidence, related pipeline stages, and linked findings.
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
