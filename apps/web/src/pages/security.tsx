import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarClock, FileWarning, Filter } from "lucide-react";
import {
  FINDING_STATUSES,
  FINDING_TYPES,
  FRAMEWORKS,
  SCANNERS,
  SEVERITIES,
  riskAcceptanceSchema,
  type FindingFilters,
  type RiskAcceptanceRequest,
  type SecurityFinding,
} from "@secureflow/types";
import { applications, remediationTasks, riskExceptions, userById, users } from "@secureflow/mock-data";
import { PageHeader } from "@/components/domain/page-header";
import { SeverityBadge } from "@/components/domain/badges";
import { AIPanel } from "@/components/domain/ai-panel";
import { BarsHorizontal, ChartCard, Donut } from "@/components/domain/charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import { EmptyState, Skeleton, Tooltip } from "@/components/ui/misc";
import { useFindingExplanation, useFindings, useUpdateFindingStatus } from "@/lib/queries";
import { formatDateTime, formatRelative, titleCase } from "@/lib/utils";
import { useCan } from "@/stores/session";
import { toast } from "sonner";

const STATUS_COLORS: Record<SecurityFinding["status"], string> = {
  open: "var(--danger)",
  "in-remediation": "var(--info)",
  "accepted-risk": "var(--warn)",
  "false-positive": "var(--pending)",
  resolved: "var(--ok)",
};

export default function SecurityPage() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("finding");
  const [filters, setFilters] = useState<FindingFilters>({});
  const { data: findings, isLoading } = useFindings(filters);
  const { data: allFindings } = useFindings();
  const selected = (allFindings ?? []).find((f) => f.id === selectedId) ?? null;

  const set = (key: keyof FindingFilters, value: string) =>
    setFilters((f) => ({ ...f, [key]: value === "all" ? undefined : value }));

  const charts = useMemo(() => {
    const all = allFindings ?? [];
    const open = all.filter((f) => f.status === "open" || f.status === "in-remediation");
    const bySeverity = SEVERITIES.map((s) => ({
      name: titleCase(s),
      value: open.filter((f) => f.severity === s).length,
      color: `var(--${s})`,
    })).filter((d) => d.value > 0);
    const byApp = applications.map((a) => ({
      name: a.name,
      count: open.filter((f) => f.applicationId === a.id).length,
      color: "var(--accent)",
    }));
    const byScanner = [...new Set(all.map((f) => f.scanner))].map((s) => ({
      name: s,
      count: all.filter((f) => f.scanner === s).length,
      color: "var(--info)",
    }));
    const slaBreaches = open.filter((f) => new Date(f.slaDueDate).getTime() < Date.now());
    return { bySeverity, byApp, byScanner, slaBreaches, openCount: open.length };
  }, [allFindings]);

  return (
    <div className="mx-auto max-w-[1500px] p-6 rise-in">
      <PageHeader
        title="Security command center"
        subtitle={`${charts.openCount} open findings · ${charts.slaBreaches.length} SLA breach(es) · ${riskExceptions.length} active risk exception(s) · ${remediationTasks.filter((t) => t.status !== "done").length} remediation tasks`}
      />

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <ChartCard title="Open findings by severity" height={170}>
          <Donut data={charts.bySeverity} />
        </ChartCard>
        <ChartCard title="Findings by application" height={170}>
          <BarsHorizontal data={charts.byApp} dataKey="count" colorKey="color" />
        </ChartCard>
        <ChartCard title="Findings by scanner" height={170}>
          <BarsHorizontal data={charts.byScanner} dataKey="count" colorKey="color" />
        </ChartCard>
      </div>

      <Card>
        {/* Filter toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Filter size={14} className="text-fg-faint" aria-hidden />
          <label htmlFor="f-search" className="sr-only">Search findings</label>
          <Input id="f-search" placeholder="Search title, rule, CVE, resource…" className="max-w-56" onChange={(e) => set("search", e.target.value || "all")} />
          <label htmlFor="f-app" className="sr-only">Application</label>
          <Select id="f-app" className="w-40" onChange={(e) => set("applicationId", e.target.value)}>
            <option value="all">All applications</option>
            {applications.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <label htmlFor="f-sev" className="sr-only">Severity</label>
          <Select id="f-sev" className="w-32" onChange={(e) => set("severity", e.target.value)}>
            <option value="all">All severities</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </Select>
          <label htmlFor="f-status" className="sr-only">Status</label>
          <Select id="f-status" className="w-36" onChange={(e) => set("status", e.target.value)}>
            <option value="all">All statuses</option>
            {FINDING_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </Select>
          <label htmlFor="f-type" className="sr-only">Type</label>
          <Select id="f-type" className="w-36" onChange={(e) => set("type", e.target.value)}>
            <option value="all">All types</option>
            {FINDING_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </Select>
          <label htmlFor="f-scanner" className="sr-only">Scanner</label>
          <Select id="f-scanner" className="w-36" onChange={(e) => set("scanner", e.target.value)}>
            <option value="all">All scanners</option>
            {SCANNERS.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <label htmlFor="f-fw" className="sr-only">Framework</label>
          <Select id="f-fw" className="w-44" onChange={(e) => set("frameworkId", e.target.value)}>
            <option value="all">All frameworks</option>
            {FRAMEWORKS.map((f) => <option key={f} value={f}>{titleCase(f)}</option>)}
          </Select>
          <label htmlFor="f-owner" className="sr-only">Owner</label>
          <Select id="f-owner" className="w-40" onChange={(e) => set("ownerUserId", e.target.value)}>
            <option value="all">All owners</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <span className="ml-auto text-xs text-fg-faint">{findings?.length ?? 0} shown</span>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : (findings ?? []).length === 0 ? (
          <div className="p-4">
            <EmptyState title="No findings match these filters" hint="Broaden the severity, status, or scanner filters." />
          </div>
        ) : (
          <ul className="divide-y divide-line/60">
            {(findings ?? []).map((f) => {
              const overdue = new Date(f.slaDueDate).getTime() < Date.now() && (f.status === "open" || f.status === "in-remediation");
              return (
                <li key={f.id}>
                  <button
                    onClick={() => setParams({ finding: f.id })}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 cursor-pointer"
                  >
                    <SeverityBadge severity={f.severity} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{f.title}</p>
                      <p className="mt-0.5 truncate font-mono text-xs text-fg-faint">
                        {f.ruleId}{f.cve ? ` · ${f.cve}` : ""} · {f.affectedResource}
                        {f.filePath ? ` · ${f.filePath}${f.lineNumber ? `:${f.lineNumber}` : ""}` : ""}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-faint">
                        <Badge color={STATUS_COLORS[f.status]}>{titleCase(f.status)}</Badge>
                        <span>{applications.find((a) => a.id === f.applicationId)?.name}</span>
                        <span>· {f.scanner}</span>
                        <span>· {titleCase(f.environment)}</span>
                        <span>· owner {userById(f.ownerUserId).name}</span>
                        {f.blocksDeployment && <Badge color="var(--blocked)">Blocks deploy</Badge>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-[11px]">
                      <p className={overdue ? "font-medium text-danger" : "text-fg-faint"}>
                        <CalendarClock size={11} className="mr-1 inline" aria-hidden />
                        SLA {overdue ? "breached" : formatRelative(f.slaDueDate).replace(" ago", "")}
                      </p>
                      <p className="mt-1 text-fg-faint">found {formatRelative(f.firstDetectedAt)}</p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {selected && (
        <FindingDetail
          finding={selected}
          onClose={() => setParams({})}
        />
      )}
    </div>
  );
}

function FindingDetail({ finding, onClose }: { finding: SecurityFinding; onClose: () => void }) {
  const { data: explanation, isLoading } = useFindingExplanation(finding.id);
  const update = useUpdateFindingStatus();
  const canUpdate = useCan("finding.update-status");
  const canAcceptRisk = useCan("risk.accept");
  const canRemediate = useCan("remediation.create");
  const [acceptOpen, setAcceptOpen] = useState(false);

  const form = useForm<RiskAcceptanceRequest>({
    resolver: zodResolver(riskAcceptanceSchema),
    defaultValues: { reason: "", expiresAt: "" },
  });

  const acceptRisk = form.handleSubmit((values) => {
    update.mutate({
      findingId: finding.id,
      status: "accepted-risk",
      reason: `Risk accepted until ${values.expiresAt}: ${values.reason}`,
    });
    setAcceptOpen(false);
    onClose();
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={finding.title} wide>
      <div className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1 thin-scroll lg:grid-cols-2">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            <SeverityBadge severity={finding.severity} />
            <Badge color={STATUS_COLORS[finding.status]}>{titleCase(finding.status)}</Badge>
            <Badge color="var(--pending)">{finding.scanner}</Badge>
            <Badge color="var(--pending)">{titleCase(finding.type)}</Badge>
            {finding.blocksDeployment && <Badge color="var(--blocked)">Blocks deployment</Badge>}
          </div>
          <p className="text-sm text-fg-muted">{finding.description}</p>
          <dl className="space-y-1.5 rounded-md border border-line bg-surface-2 p-3 text-xs">
            <div className="flex justify-between gap-3"><dt className="text-fg-faint">Rule / CVE</dt><dd className="font-mono text-fg">{finding.ruleId}{finding.cve ? ` · ${finding.cve}` : ""}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-fg-faint">Resource</dt><dd className="truncate font-mono text-fg">{finding.affectedResource}</dd></div>
            {finding.filePath && (
              <div className="flex justify-between gap-3"><dt className="text-fg-faint">Location</dt><dd className="font-mono text-fg">{finding.filePath}{finding.lineNumber ? `:${finding.lineNumber}` : ""}</dd></div>
            )}
            <div className="flex justify-between gap-3"><dt className="text-fg-faint">Exploitability</dt><dd className="text-fg">{titleCase(finding.exploitability)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-fg-faint">Reachability</dt><dd className="text-fg">{titleCase(finding.reachability)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-fg-faint">Owner</dt><dd className="text-fg">{userById(finding.ownerUserId).name}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-fg-faint">SLA due</dt><dd className="text-fg">{formatDateTime(finding.slaDueDate)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-fg-faint">First detected</dt><dd className="text-fg">{formatDateTime(finding.firstDetectedAt)}</dd></div>
          </dl>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">Business impact</p>
            <p className="mt-1 text-sm text-fg-muted">{finding.businessImpact}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">Suggested fix</p>
            <p className="mt-1 text-sm text-fg-muted">{finding.suggestedFix}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">Compliance mappings</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {finding.complianceMappings.map((m) => (
                <Badge key={`${m.frameworkId}-${m.controlId}`} color="var(--accent)">
                  {titleCase(m.frameworkId)} {m.controlId}
                </Badge>
              ))}
            </div>
          </div>
          {finding.evidence.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">Evidence</p>
              <ul className="mt-1 space-y-1 font-mono text-xs text-fg-muted">
                {finding.evidence.map((e) => <li key={e}>• {e}</li>)}
              </ul>
            </div>
          )}
          {finding.suppressionHistory.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">Suppression history</p>
              <ul className="mt-1 space-y-1.5 text-xs text-fg-muted">
                {finding.suppressionHistory.map((s, i) => (
                  <li key={i} className="rounded border border-line bg-surface-2 p-2">
                    <span className="text-fg">{s.by}</span> · {formatDateTime(s.date)} — {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <AIPanel recommendation={explanation} loading={isLoading} />
          <div className="flex flex-wrap gap-2">
            <Tooltip label={canUpdate ? "Mark resolved" : "Requires finding.update-status (RBAC)"}>
              <span tabIndex={0}>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!canUpdate || finding.status === "resolved"}
                  onClick={() => {
                    update.mutate({ findingId: finding.id, status: "resolved", reason: "Verified fixed." });
                    onClose();
                  }}
                >
                  Mark resolved
                </Button>
              </span>
            </Tooltip>
            <Tooltip label={canUpdate ? "Flag as false positive" : "Requires finding.update-status (RBAC)"}>
              <span tabIndex={0}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!canUpdate}
                  onClick={() => {
                    update.mutate({ findingId: finding.id, status: "false-positive", reason: "Triaged as false positive." });
                    onClose();
                  }}
                >
                  False positive
                </Button>
              </span>
            </Tooltip>
            <Tooltip label={canAcceptRisk ? "Document and accept this risk" : "Requires risk.accept (RBAC)"}>
              <span tabIndex={0}>
                <Button variant="secondary" size="sm" disabled={!canAcceptRisk} onClick={() => setAcceptOpen(true)}>
                  <FileWarning size={13} /> Accept risk
                </Button>
              </span>
            </Tooltip>
            <Tooltip label={canRemediate ? "Create a tracked remediation task" : "Requires remediation.create (RBAC)"}>
              <span tabIndex={0}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!canRemediate}
                  onClick={() =>
                    toast.success("Remediation task created (simulated)", {
                      description: `Tracked as ${finding.ruleId} in the connected issue tracker.`,
                    })
                  }
                >
                  Create remediation task
                </Button>
              </span>
            </Tooltip>
          </div>
        </div>
      </div>

      <Dialog
        open={acceptOpen}
        onOpenChange={setAcceptOpen}
        title="Accept documented risk"
        description="Risk acceptance requires business justification and an expiry. It is recorded in the audit log and reviewed at expiry."
      >
        <form onSubmit={acceptRisk} className="space-y-3">
          <div>
            <Label htmlFor="risk-reason">Business justification</Label>
            <Textarea id="risk-reason" {...form.register("reason")} placeholder="Why is this risk acceptable, and what bounds it?" />
            <FieldError message={form.formState.errors.reason?.message} />
          </div>
          <div>
            <Label htmlFor="risk-expiry">Expires</Label>
            <Input id="risk-expiry" type="date" {...form.register("expiresAt")} />
            <FieldError message={form.formState.errors.expiresAt?.message} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAcceptOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Accept risk</Button>
          </div>
        </form>
      </Dialog>
    </Dialog>
  );
}
