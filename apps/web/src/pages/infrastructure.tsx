import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { GitCompareArrows, Lock, Unlock } from "lucide-react";
import type { InfrastructureResourceChange } from "@secureflow/types";
import { applications } from "@secureflow/mock-data";
import { PageHeader } from "@/components/domain/page-header";
import { AIPanel } from "@/components/domain/ai-panel";
import { SeverityBadge } from "@/components/domain/badges";
import { DiffViewer } from "@/components/domain/log-viewer";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { usePlans, usePlanSummary } from "@/lib/queries";
import { cn, formatDateTime, formatUsd, titleCase } from "@/lib/utils";

const ACTION_COLORS: Record<InfrastructureResourceChange["action"], string> = {
  create: "var(--ok)",
  update: "var(--warn)",
  delete: "var(--danger)",
  replace: "var(--blocked)",
  "no-op": "var(--pending)",
};

function attrsToHcl(prefix: string, attrs?: Record<string, string>): string {
  if (!attrs) return "";
  return Object.entries(attrs)
    .map(([k, v]) => `${prefix}${k} = "${v}"`)
    .join("\n");
}

export default function InfrastructurePage() {
  const [params, setParams] = useSearchParams();
  const { data: plans, isLoading } = usePlans();
  const selectedId = params.get("plan") ?? plans?.[0]?.id ?? null;
  const plan = plans?.find((p) => p.id === selectedId) ?? null;
  const { data: aiSummary, isLoading: aiLoading } = usePlanSummary(plan?.id ?? null);

  const diff = useMemo(() => {
    if (!plan) return { before: "", after: "" };
    const changed = plan.resources.filter((r) => r.action !== "no-op");
    const before = changed
      .map((r) => `# ${r.address}\n${r.before ? attrsToHcl(r.action === "delete" ? "- " : "  ", r.before) : "# (does not exist)"}`)
      .join("\n\n");
    const after = changed
      .map((r) => `# ${r.address}\n${r.action === "delete" ? "# (destroyed)" : attrsToHcl(r.action === "create" ? "+ " : "  ", r.after)}`)
      .join("\n\n");
    return { before, after };
  }, [plan]);

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
        title="Infrastructure changes"
        subtitle="Terraform plans, policy evaluation, drift, and cost — reviewed before any apply"
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {(plans ?? []).map((p) => (
          <button
            key={p.id}
            onClick={() => setParams({ plan: p.id })}
            className={cn(
              "rounded-md border px-3 py-2 text-left transition-colors cursor-pointer",
              p.id === selectedId
                ? "border-accent bg-accent/10"
                : "border-line bg-surface hover:border-line-strong",
            )}
          >
            <p className="text-xs font-medium text-fg">
              {applications.find((a) => a.id === p.applicationId)?.name} · {titleCase(p.environment)}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-fg-faint">
              <span className="text-ok">+{p.summary.add}</span>{" "}
              <span className="text-warn">~{p.summary.change}</span>{" "}
              <span className="text-danger">-{p.summary.destroy}</span>
              {" · "}{p.id}
            </p>
          </button>
        ))}
      </div>

      {plan && (
        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <div className="space-y-4 min-w-0">
            <Card>
              <CardHeader
                title="Plan summary"
                subtitle={`Created ${formatDateTime(plan.createdAt)} · run ${plan.pipelineRunId}`}
                actions={
                  <>
                    <Badge color={plan.driftStatus === "in-sync" ? "var(--ok)" : "var(--warn)"} dot>
                      {titleCase(plan.driftStatus)}
                    </Badge>
                    <Badge color={plan.stateStatus === "locked" ? "var(--info)" : "var(--pending)"}>
                      {plan.stateStatus === "locked" ? <Lock size={10} className="mr-1 inline" /> : <Unlock size={10} className="mr-1 inline" />}
                      State {plan.stateStatus}
                    </Badge>
                    {plan.requiresApproval && <Badge color="var(--warn)">Approval required</Badge>}
                  </>
                }
              />
              <CardBody>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
                  <div><dt className="text-fg-faint">Resources to add</dt><dd className="mt-0.5 font-mono text-lg text-ok">+{plan.summary.add}</dd></div>
                  <div><dt className="text-fg-faint">To modify</dt><dd className="mt-0.5 font-mono text-lg text-warn">~{plan.summary.change}</dd></div>
                  <div><dt className="text-fg-faint">To destroy</dt><dd className="mt-0.5 font-mono text-lg text-danger">-{plan.summary.destroy}</dd></div>
                  <div>
                    <dt className="text-fg-faint">Monthly cost estimate</dt>
                    <dd className="mt-0.5 font-mono text-lg text-fg">
                      {formatUsd(plan.monthlyCostEstimateUsd)}
                      <span className={cn("ml-1.5 text-xs", plan.costDeltaUsd > 0 ? "text-warn" : "text-ok")}>
                        {plan.costDeltaUsd >= 0 ? "+" : ""}{formatUsd(plan.costDeltaUsd)}
                      </span>
                    </dd>
                  </div>
                  <div><dt className="text-fg-faint">Last successful apply</dt><dd className="mt-0.5 text-fg">{formatDateTime(plan.lastApplyAt)}</dd></div>
                  <div className="col-span-2 sm:col-span-3">
                    <dt className="text-fg-faint">Module versions</dt>
                    <dd className="mt-0.5 flex flex-wrap gap-1.5">
                      {plan.moduleVersions.map((m) => (
                        <span key={m.module} className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
                          {m.module}@{m.version}
                        </span>
                      ))}
                    </dd>
                  </div>
                </dl>
              </CardBody>
            </Card>

            {plan.policyViolations.length > 0 && (
              <Card>
                <CardHeader title="Policy violations" subtitle="Must be resolved or excepted before apply" />
                <ul className="divide-y divide-line/60">
                  {plan.policyViolations.map((v, i) => (
                    <li key={i} className="flex items-start gap-3 px-4 py-3">
                      <SeverityBadge severity={v.severity} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-fg">{v.policy}</p>
                        <p className="mt-0.5 font-mono text-xs text-fg-faint">{v.resource}</p>
                        <p className="mt-1 text-xs text-fg-muted">{v.message}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Card>
              <CardHeader title="Resource changes" subtitle="Every planned Terraform action, with security notes" />
              <ul className="divide-y divide-line/60">
                {plan.resources.map((r) => (
                  <li key={r.address} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge color={ACTION_COLORS[r.action]}>{r.action}</Badge>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{r.address}</span>
                      <span className="font-mono text-[10px] text-fg-faint">{r.resourceType}</span>
                    </div>
                    {r.securityNotes && (
                      <p className={cn("mt-1.5 text-xs", r.securityNotes.startsWith("BLOCKED") ? "text-danger" : "text-fg-muted")}>
                        {r.securityNotes}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <CardHeader
                title="Previous vs proposed infrastructure"
                subtitle="Side-by-side comparison of changed resources"
                actions={<GitCompareArrows size={15} className="text-fg-faint" aria-hidden />}
              />
              <CardBody>
                <DiffViewer before={diff.before} after={diff.after} />
              </CardBody>
            </Card>
          </div>

          <div className="space-y-4">
            <AIPanel recommendation={aiSummary} loading={aiLoading} />
          </div>
        </div>
      )}
    </div>
  );
}
