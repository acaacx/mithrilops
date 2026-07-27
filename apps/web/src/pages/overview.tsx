import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity,
  CircleAlert,
  Rocket,
  Timer,
  Undo2,
} from "lucide-react";
import { ENVIRONMENTS } from "@secureflow/types";
import type { DeploymentStatus, PipelineStage } from "@secureflow/types";
import { incidents } from "@secureflow/mock-data";
import { PageHeader } from "@/components/domain/page-header";
import { MetricCard } from "@/components/domain/metric-card";
import { BarsHorizontal, ChartCard, Donut, MultiLine, TrendArea } from "@/components/domain/charts";
import { AIPanel } from "@/components/domain/ai-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { SeverityBadge, StatusBadge, stageStatusColor } from "@/components/domain/badges";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import {
  useApplications,
  useAuditEvents,
  useDeployments,
  useExecutiveSummary,
  useFindings,
  useRuns,
} from "@/lib/queries";
import { cn, formatRelative, titleCase } from "@/lib/utils";
import { useSession } from "@/stores/session";

const RANGES = ["Last 24 hours", "Last 7 days", "Last 30 days", "Last 90 days"] as const;

/** Deterministic trend series scaled by range for the mock dashboard. */
function trendSeries(range: string) {
  const points = range === "Last 24 hours" ? 8 : range === "Last 7 days" ? 7 : range === "Last 30 days" ? 10 : 12;
  const vulns = [22, 25, 24, 28, 26, 23, 21, 24, 20, 19, 17, 18];
  const resolved = [3, 5, 4, 6, 8, 5, 7, 9, 6, 8, 10, 7];
  const created = [6, 4, 7, 5, 6, 4, 5, 6, 3, 5, 4, 6];
  const deploys = [4, 6, 3, 7, 5, 8, 6, 5, 9, 7, 6, 8];
  const label = (i: number) =>
    range === "Last 24 hours" ? `${i * 3}h` : range === "Last 7 days" ? `D${i + 1}` : `W${i + 1}`;
  return Array.from({ length: points }, (_, i) => ({
    label: label(i),
    vulnerabilities: vulns[i % 12] ?? 20,
    resolved: resolved[i % 12] ?? 5,
    created: created[i % 12] ?? 5,
    deployments: deploys[i % 12] ?? 6,
  }));
}

const DEPLOY_STATUS_COLORS: Record<DeploymentStatus, string> = {
  healthy: "var(--ok)",
  progressing: "var(--info)",
  degraded: "var(--warn)",
  failed: "var(--danger)",
  "rolled-back": "var(--warn)",
};

function StageDots({ stages }: { stages: PipelineStage[] }) {
  return (
    <span className="flex items-center gap-1">
      {stages.map((s) => (
        <span
          key={s.id}
          title={`${s.name} — ${titleCase(s.status)}`}
          className={cn("h-2 w-2 rounded-full", s.status === "running" && "pulse-dot")}
          style={{ background: stageStatusColor(s.status) }}
        />
      ))}
    </span>
  );
}

function SegmentTile({
  label,
  total,
  segments,
  note,
  noteGood,
}: {
  label: string;
  total: number;
  segments: { name: string; value: number; color: string }[];
  note?: string;
  noteGood?: boolean;
}) {
  const present = segments.filter((s) => s.value > 0);
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">{label}</p>
        <p className="font-mono text-2xl font-semibold tracking-tight text-fg">{total}</p>
      </div>
      <div className="mt-2 flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-surface-3">
        {total > 0
          ? present.map((s) => (
              <span key={s.name} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
            ))
          : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {present.map((s) => (
          <span key={s.name} className="flex items-center gap-1 text-[11px] text-fg-muted">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
            {s.name} <span className="font-mono text-fg">{s.value}</span>
          </span>
        ))}
      </div>
      {note ? (
        <p className={cn("mt-1.5 text-[11px]", noteGood === false ? "text-danger" : "text-fg-faint")}>{note}</p>
      ) : null}
    </Card>
  );
}

export default function OverviewPage() {
  const [range, setRange] = useState<string>("Last 30 days");
  const [team, setTeam] = useState("all");
  const { data: apps, isLoading: appsLoading } = useApplications();
  const { data: runs } = useRuns();
  const { data: findings } = useFindings();
  const { data: deployments } = useDeployments();
  const { data: auditEvents } = useAuditEvents();
  const { data: summary, isLoading: aiLoading } = useExecutiveSummary();
  const environment = useSession((s) => s.environment);
  const navigate = useNavigate();

  const series = useMemo(() => trendSeries(range), [range]);

  const scopedRuns = useMemo(() => {
    const all = runs ?? [];
    return environment === "all" ? all : all.filter((r) => r.environment === environment);
  }, [runs, environment]);

  const openFindings = useMemo(
    () => (findings ?? []).filter((f) => f.status === "open" || f.status === "in-remediation"),
    [findings],
  );

  const stats = useMemo(() => {
    const finished = scopedRuns.filter((r) => r.finishedAt);
    const succeeded = scopedRuns.filter((r) => r.status === "succeeded").length;
    return {
      successRate: finished.length ? Math.round((succeeded / finished.length) * 100) : 0,
      slaBreaches: openFindings.filter((f) => new Date(f.slaDueDate).getTime() < Date.now()).length,
    };
  }, [scopedRuns, openFindings]);

  const appName = useMemo(() => new Map((apps ?? []).map((a) => [a.id, a.name])), [apps]);

  const envStatus = useMemo(
    () =>
      ENVIRONMENTS.map((env) => ({
        env,
        latest: (deployments ?? [])
          .filter((d) => d.environment === env)
          .sort((a, b) => new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime())[0],
      })),
    [deployments],
  );

  const latestRuns = useMemo(
    () =>
      [...scopedRuns]
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
        .slice(0, 6),
    [scopedRuns],
  );

  const recentActivity = useMemo(
    () =>
      [...(auditEvents ?? [])]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 8),
    [auditEvents],
  );

  const runSegments = useMemo(() => {
    const count = (status: string) => scopedRuns.filter((r) => r.status === status).length;
    return [
      { name: "Failed", value: count("failed"), color: "var(--danger)" },
      { name: "Blocked", value: count("blocked"), color: "var(--blocked)" },
      { name: "Awaiting approval", value: count("waiting-approval"), color: "var(--warn)" },
      { name: "Rolled back", value: count("rolled-back"), color: "var(--warn)" },
      { name: "Running", value: count("running"), color: "var(--info)" },
      { name: "Cancelled", value: count("cancelled"), color: "var(--pending)" },
      { name: "Succeeded", value: count("succeeded"), color: "var(--ok)" },
    ];
  }, [scopedRuns]);

  const gateSegments = useMemo(() => {
    const count = (gate: string) => scopedRuns.filter((r) => r.securityGate === gate).length;
    return [
      { name: "Failed", value: count("failed"), color: "var(--danger)" },
      { name: "Waived", value: count("waived"), color: "var(--warn)" },
      { name: "In progress", value: count("in-progress"), color: "var(--info)" },
      { name: "Passed", value: count("passed"), color: "var(--ok)" },
    ];
  }, [scopedRuns]);

  const findingSegments = useMemo(() => {
    const count = (sev: string) => openFindings.filter((f) => f.severity === sev).length;
    return [
      { name: "Critical", value: count("critical"), color: "var(--critical)" },
      { name: "High", value: count("high"), color: "var(--high)" },
      { name: "Medium", value: count("medium"), color: "var(--medium)" },
      { name: "Low", value: count("low"), color: "var(--low)" },
      { name: "Info", value: count("informational"), color: "var(--pending)" },
    ];
  }, [openFindings]);

  const deploySegments = useMemo(() => {
    const count = (status: DeploymentStatus) => (deployments ?? []).filter((d) => d.status === status).length;
    return [
      { name: "Failed", value: count("failed"), color: "var(--danger)" },
      { name: "Degraded", value: count("degraded"), color: "var(--warn)" },
      { name: "Rolled back", value: count("rolled-back"), color: "var(--warn)" },
      { name: "Progressing", value: count("progressing"), color: "var(--info)" },
      { name: "Healthy", value: count("healthy"), color: "var(--ok)" },
    ];
  }, [deployments]);

  const severityDonut = useMemo(() => {
    const count = (sev: string) => openFindings.filter((f) => f.severity === sev).length;
    return [
      { name: "Critical", value: count("critical"), color: "var(--critical)" },
      { name: "High", value: count("high"), color: "var(--high)" },
      { name: "Medium", value: count("medium"), color: "var(--medium)" },
      { name: "Low", value: count("low"), color: "var(--low)" },
    ].filter((d) => d.value > 0);
  }, [openFindings]);

  const riskBars = useMemo(
    () =>
      (apps ?? []).map((a) => ({
        name: a.name,
        score: 100 - a.securityScore,
        color:
          a.riskLevel === "critical"
            ? "var(--critical)"
            : a.riskLevel === "high"
              ? "var(--high)"
              : a.riskLevel === "medium"
                ? "var(--medium)"
                : "var(--low)",
      })),
    [apps],
  );

  return (
    <div className="mx-auto max-w-[1500px] p-6 rise-in">
      <PageHeader
        title="Executive overview"
        subtitle="Exceptions first — blocked releases, failing gates, and SLA breaches across the portfolio"
        actions={
          <>
            <Badge color="var(--ok)" dot pulse>Live · mock feed</Badge>
            <label htmlFor="range" className="sr-only">Time range</label>
            <Select id="range" className="w-40" value={range} onChange={(e) => setRange(e.target.value)}>
              {RANGES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
            <label htmlFor="team" className="sr-only">Team</label>
            <Select id="team" className="w-44" value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="all">All teams & units</option>
              <option>Financial Services</option>
              <option>Customer</option>
              <option>Platform</option>
              <option>Analytics</option>
            </Select>
          </>
        }
      />

      {/* Environment status strip */}
      <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {envStatus.map(({ env, latest }) => (
          <Card key={env} className="flex items-center gap-3 px-4 py-3">
            <span
              aria-hidden
              className={cn("h-2 w-2 shrink-0 rounded-full", latest?.status === "progressing" && "pulse-dot")}
              style={{ background: latest ? DEPLOY_STATUS_COLORS[latest.status] : "var(--pending)" }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">{titleCase(env)}</p>
              <p className="truncate text-xs text-fg-muted">
                {latest ? `${latest.version} · ${titleCase(latest.status)}` : "No deployments"}
              </p>
            </div>
            {latest ? (
              <span className="shrink-0 text-[11px] text-fg-faint">{formatRelative(latest.deployedAt)}</span>
            ) : null}
          </Card>
        ))}
      </div>

      {/* DORA row */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Deployment success" value={`${stats.successRate}%`} trend="up" trendLabel="+4% vs prior period" trendGood icon={<Rocket size={15} />} accent="var(--ok)" />
        <MetricCard label="Deploy frequency" value="5.2/day" trend="up" trendLabel="+0.8 vs prior" trendGood icon={<Activity size={15} />} />
        <MetricCard label="Lead time" value="3.1h" trend="down" trendLabel="-22m vs prior" trendGood icon={<Timer size={15} />} />
        <MetricCard label="MTTR" value="24m" trend="down" trendLabel="-6m vs prior" trendGood icon={<Undo2 size={15} />} />
        <MetricCard label="Change failure" value="6.8%" trend="up" trendLabel="+1.2% vs prior" trendGood={false} icon={<CircleAlert size={15} />} accent="var(--warn)" />
      </div>

      {/* Segmented count tiles */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SegmentTile label="Pipeline runs" total={scopedRuns.length} segments={runSegments} />
        <SegmentTile label="Security gates" total={scopedRuns.length} segments={gateSegments} />
        <SegmentTile
          label="Open findings"
          total={openFindings.length}
          segments={findingSegments}
          note={`${stats.slaBreaches} SLA breach(es)`}
          noteGood={stats.slaBreaches === 0}
        />
        <SegmentTile label="Deployments" total={(deployments ?? []).length} segments={deploySegments} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader
              title="Latest pipeline runs"
              subtitle="Most recent activity across the portfolio"
              actions={
                <Link to="/pipelines" className="text-xs text-accent hover:underline">
                  View all
                </Link>
              }
            />
            <Table>
              <thead>
                <tr>
                  <Th>Run</Th>
                  <Th>Application</Th>
                  <Th>Environment</Th>
                  <Th>Stages</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Started</Th>
                </tr>
              </thead>
              <tbody>
                {latestRuns.map((r) => (
                  <Tr key={r.id} className="cursor-pointer" onClick={() => navigate(`/pipelines/${r.id}`)}>
                    <Td className="font-mono text-xs text-accent">{r.id}</Td>
                    <Td className="whitespace-nowrap text-fg">{appName.get(r.applicationId) ?? r.applicationId}</Td>
                    <Td>{titleCase(r.environment)}</Td>
                    <Td>
                      <StageDots stages={r.stages} />
                    </Td>
                    <Td>
                      <StatusBadge status={r.status} />
                    </Td>
                    <Td className="whitespace-nowrap text-right text-xs">{formatRelative(r.startedAt)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Vulnerability trend" subtitle="Open findings over time">
              <TrendArea data={series} dataKey="vulnerabilities" color="var(--high)" />
            </ChartCard>
            <ChartCard title="New vs resolved findings" subtitle="Security debt direction">
              <MultiLine
                data={series}
                series={[
                  { key: "created", color: "var(--danger)" },
                  { key: "resolved", color: "var(--ok)" },
                ]}
              />
            </ChartCard>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Deployment activity" subtitle={`Per environment · ${environment === "all" ? "all environments" : titleCase(environment)}`}>
              <TrendArea data={series} dataKey="deployments" color="var(--info)" />
            </ChartCard>
            <ChartCard title="Applications by risk" subtitle="Inverse security score (higher = riskier)">
              <BarsHorizontal data={riskBars} dataKey="score" colorKey="color" />
            </ChartCard>
          </div>

          <Card>
            <CardHeader
              title="Top recurring policy violations"
              subtitle="Most frequent gate failures, last 30 days"
            />
            <ul className="divide-y divide-line/60">
              {[
                { rule: "CKV_AZURE_109 — Key Vault public network access", count: 7, sev: "high" as const },
                { rule: "KSV-012 — Container runs as root", count: 6, sev: "high" as const },
                { rule: "Critical CVE gate (Trivy)", count: 5, sev: "critical" as const },
                { rule: "KSV-011 — Missing resource limits", count: 4, sev: "medium" as const },
                { rule: "azure-network-no-public-ingress (tfsec)", count: 3, sev: "high" as const },
              ].map((v) => (
                <li key={v.rule} className="flex items-center gap-3 px-4 py-2.5">
                  <SeverityBadge severity={v.sev} />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">{v.rule}</span>
                  <span className="font-mono text-sm text-fg">{v.count}×</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          <AIPanel recommendation={summary} loading={aiLoading} />

          <ChartCard title="Open findings by severity" height={190}>
            <Donut data={severityDonut} />
          </ChartCard>

          <Card>
            <CardHeader
              title="Active incidents"
              actions={<Badge color="var(--danger)" dot pulse>{incidents.filter((i) => i.status === "active").length} active</Badge>}
            />
            <ul className="divide-y divide-line/60">
              {incidents.map((inc) => (
                <li key={inc.id} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={inc.severity} />
                    <Badge color={inc.status === "active" ? "var(--danger)" : "var(--warn)"}>{titleCase(inc.status)}</Badge>
                    <span className="ml-auto text-[11px] text-fg-faint">{formatRelative(inc.startedAt)}</span>
                  </div>
                  <p className="mt-1.5 text-sm font-medium text-fg">{inc.title}</p>
                  <p className="mt-0.5 text-xs text-fg-muted">{inc.summary}</p>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Pipeline health" subtitle="Composite score by application" />
            <ul className="divide-y divide-line/60">
              {appsLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <li key={i} className="px-4 py-3"><Skeleton className="h-5 w-full" /></li>
                  ))
                : (apps ?? []).map((a) => (
                    <li key={a.id}>
                      <Link to={`/applications/${a.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
                        <span className="min-w-0 flex-1 truncate text-sm text-fg">{a.name}</span>
                        <Badge
                          color={a.pipelineHealth === "healthy" ? "var(--ok)" : a.pipelineHealth === "unstable" ? "var(--warn)" : "var(--danger)"}
                          dot
                        >
                          {titleCase(a.pipelineHealth)}
                        </Badge>
                        <span className="w-10 text-right font-mono text-sm text-fg">{Math.round((a.securityScore + a.complianceScore) / 2)}</span>
                      </Link>
                    </li>
                  ))}
            </ul>
          </Card>
        </div>
      </div>

      {/* Activity strip */}
      <Card className="mt-4">
        <CardHeader
          title="Recent activity"
          subtitle="Latest control-plane events"
          actions={
            <Link to="/audit" className="text-xs text-accent hover:underline">
              Audit log
            </Link>
          }
        />
        <ul className="thin-scroll flex gap-3 overflow-x-auto p-4">
          {recentActivity.map((e) => (
            <li key={e.id} className="min-w-56 shrink-0 rounded-lg border border-line/60 bg-surface-2/40 px-3 py-2">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    background:
                      e.outcome === "success" ? "var(--ok)" : e.outcome === "denied" ? "var(--warn)" : "var(--danger)",
                  }}
                />
                <span className="truncate text-xs font-medium text-fg">{e.actor}</span>
                <span className="ml-auto whitespace-nowrap text-[11px] text-fg-faint">{formatRelative(e.timestamp)}</span>
              </div>
              <p className="mt-1 truncate text-xs text-fg-muted">
                {titleCase(e.action)} · {e.target}
              </p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
