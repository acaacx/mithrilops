import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, ExternalLink } from "lucide-react";
import { incidents, repositories, teams, userById } from "@secureflow/mock-data";
import { PageHeader } from "@/components/domain/page-header";
import { ArchitectureFlow } from "@/components/domain/architecture-flow";
import { GateBadge, SeverityBadge, StatusBadge } from "@/components/domain/badges";
import { MetricCard } from "@/components/domain/metric-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useApplication,
  useArchitecture,
  useAuditEvents,
  useDeployments,
  useFindings,
  usePlans,
  useRuns,
} from "@/lib/queries";
import { formatDateTime, formatRelative, titleCase } from "@/lib/utils";
import { ENVIRONMENTS } from "@secureflow/types";
import { useSession } from "@/stores/session";

const TABS = [
  "overview",
  "pipeline",
  "architecture",
  "security",
  "infrastructure",
  "deployments",
  "compliance",
  "observability",
  "activity",
  "settings",
] as const;

export default function ApplicationWorkspacePage() {
  const { appId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "overview";
  const { data: app, isLoading } = useApplication(appId);
  const { data: runs } = useRuns({ applicationId: appId });
  const { data: findings } = useFindings({ applicationId: appId });
  const { data: deployments } = useDeployments(appId);
  const { data: plans } = usePlans(appId);
  const { data: diagram } = useArchitecture(appId);
  const { data: audit } = useAuditEvents();
  const role = useSession((s) => s.role);

  const latestRun = runs?.[0];
  const openFindings = useMemo(
    () => (findings ?? []).filter((f) => f.status === "open" || f.status === "in-remediation"),
    [findings],
  );
  const appIncidents = incidents.filter((i) => i.applicationId === appId);

  if (isLoading || !app) {
    return (
      <div className="mx-auto max-w-[1500px] space-y-4 p-6">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const repo = repositories.find((r) => r.id === app.repositoryId);
  const team = teams.find((t) => t.id === app.teamId);
  const prodDep = deployments?.find((d) => d.environment === "production");

  return (
    <div className="mx-auto max-w-[1500px] p-6 rise-in">
      <Link to="/applications" className="mb-3 inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg">
        <ArrowLeft size={13} aria-hidden /> All applications
      </Link>
      <PageHeader
        title={app.name}
        subtitle={`${app.description} · ${repo?.name} · ${team?.name}`}
        actions={
          <>
            <Badge color="var(--pending)">{app.cloudEnvironment}</Badge>
            <Badge color={app.riskLevel === "critical" ? "var(--critical)" : app.riskLevel === "high" ? "var(--high)" : "var(--medium)"}>
              Risk: {titleCase(app.riskLevel)}
            </Badge>
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {titleCase(t)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Production version" value={<span className="text-lg">{app.currentVersion}</span>} accent="var(--accent)" />
            <MetricCard label="Availability" value={app.availability} accent="var(--ok)" />
            <MetricCard label="Error rate" value={app.errorRate} />
            <MetricCard label="Latency p95" value={app.latencyP95} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Latest pipeline" actions={latestRun && <StatusBadge status={latestRun.status} />} />
              {latestRun ? (
                <CardBody className="space-y-2 text-sm">
                  <Link to={`/pipelines/${latestRun.id}`} className="flex items-center gap-1.5 font-mono text-xs text-accent hover:underline">
                    {latestRun.id} <ArrowUpRight size={12} />
                  </Link>
                  <p className="text-fg">{latestRun.commit.message}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <GateBadge gate={latestRun.securityGate} />
                    <Badge color="var(--pending)">{titleCase(latestRun.environment)}</Badge>
                    <Badge color="var(--pending)">{latestRun.artifactVersion}</Badge>
                  </div>
                  <p className="text-xs text-fg-faint">Started {formatRelative(latestRun.startedAt)} by {latestRun.commit.author}</p>
                </CardBody>
              ) : (
                <CardBody><p className="text-sm text-fg-faint">No runs recorded.</p></CardBody>
              )}
            </Card>
            <Card>
              <CardHeader title="Environment progression" />
              <CardBody className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ENVIRONMENTS.map((env) => {
                  const d = deployments?.find((x) => x.environment === env);
                  return (
                    <div key={env} className="rounded-md border border-line bg-surface-2 p-2.5 text-center">
                      <p className="text-[10px] uppercase tracking-wider text-fg-faint">{titleCase(env)}</p>
                      <p className="mt-1 font-mono text-xs text-fg">{d?.version ?? "—"}</p>
                      {d && (
                        <Badge
                          className="mt-1.5"
                          color={d.status === "healthy" ? "var(--ok)" : d.status === "progressing" ? "var(--info)" : "var(--warn)"}
                          dot
                          pulse={d.status === "progressing"}
                        >
                          {titleCase(d.status)}
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Posture" />
              <CardBody className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-fg-faint">Argo CD sync</p><p className="mt-0.5 text-fg">{titleCase(prodDep?.argoSyncStatus ?? "unknown")}</p></div>
                <div><p className="text-xs text-fg-faint">Terraform drift</p><p className="mt-0.5 text-fg">{titleCase(plans?.[0]?.driftStatus ?? "in-sync")}</p></div>
                <div><p className="text-xs text-fg-faint">Security gate</p><p className="mt-0.5 text-fg">{titleCase(latestRun?.securityGate ?? "passed")}</p></div>
                <div><p className="text-xs text-fg-faint">Open findings</p><p className="mt-0.5 font-mono text-fg">{openFindings.length}</p></div>
                <div><p className="text-xs text-fg-faint">Owner</p><p className="mt-0.5 text-fg">{userById(app.ownerUserId).name}</p></div>
                <div><p className="text-xs text-fg-faint">Team</p><p className="mt-0.5 text-fg">{team?.name}</p></div>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Open incidents" actions={<Badge color={appIncidents.some((i) => i.status === "active") ? "var(--danger)" : "var(--ok)"}>{appIncidents.length}</Badge>} />
              {appIncidents.length === 0 ? (
                <CardBody><p className="text-sm text-fg-faint">No incidents for this application.</p></CardBody>
              ) : (
                <ul className="divide-y divide-line/60">
                  {appIncidents.map((i) => (
                    <li key={i.id} className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <SeverityBadge severity={i.severity} />
                        <Badge color={i.status === "active" ? "var(--danger)" : "var(--warn)"}>{titleCase(i.status)}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-fg">{i.title}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="pipeline">
          <Card>
            <CardHeader title="Recent executions" />
            <ul className="divide-y divide-line/60">
              {(runs ?? []).map((r) => (
                <li key={r.id}>
                  <Link to={`/pipelines/${r.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
                    <span className="font-mono text-xs text-accent">{r.id}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">{r.commit.message}</span>
                    <span className="font-mono text-xs text-fg-faint">{r.commit.branch}</span>
                    <GateBadge gate={r.securityGate} />
                    <StatusBadge status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </TabsContent>

        <TabsContent value="architecture">
          {diagram ? <ArchitectureFlow diagram={diagram} /> : <Skeleton className="h-[520px]" />}
        </TabsContent>

        <TabsContent value="security">
          <Card>
            <CardHeader
              title={`Findings (${findings?.length ?? 0})`}
              actions={
                <Link to={`/security?`} className="text-xs text-accent hover:underline">
                  Open command center →
                </Link>
              }
            />
            <ul className="divide-y divide-line/60">
              {(findings ?? []).map((f) => (
                <li key={f.id}>
                  <Link to={`/security?finding=${f.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
                    <SeverityBadge severity={f.severity} />
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">{f.title}</span>
                    <Badge color="var(--pending)">{f.scanner}</Badge>
                    <Badge color="var(--pending)">{titleCase(f.status)}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </TabsContent>

        <TabsContent value="infrastructure">
          {(plans ?? []).length === 0 ? (
            <Card className="p-8 text-center text-sm text-fg-faint">No Terraform plans recorded for this application.</Card>
          ) : (
            <Card>
              <ul className="divide-y divide-line/60">
                {(plans ?? []).map((p) => (
                  <li key={p.id}>
                    <Link to={`/infrastructure?plan=${p.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
                      <span className="font-mono text-xs text-accent">{p.id}</span>
                      <span className="font-mono text-xs"><span className="text-ok">+{p.summary.add}</span> <span className="text-warn">~{p.summary.change}</span> <span className="text-danger">-{p.summary.destroy}</span></span>
                      <span className="text-xs text-fg-faint">{titleCase(p.environment)}</span>
                      {p.policyViolations.length > 0 && <Badge color="var(--danger)">{p.policyViolations.length} violation(s)</Badge>}
                      <Badge color={p.driftStatus === "in-sync" ? "var(--ok)" : "var(--warn)"} className="ml-auto">{titleCase(p.driftStatus)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="deployments">
          <Card>
            <ul className="divide-y divide-line/60">
              {(deployments ?? []).map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="w-24 text-xs font-medium text-fg">{titleCase(d.environment)}</span>
                  <span className="font-mono text-sm text-fg">{d.version}</span>
                  <Badge color={d.status === "healthy" ? "var(--ok)" : d.status === "progressing" ? "var(--info)" : "var(--warn)"} dot pulse={d.status === "progressing"}>{titleCase(d.status)}</Badge>
                  <Badge color="var(--pending)">{titleCase(d.strategy)}</Badge>
                  <GateBadge gate={d.securityGate} />
                  <span className="ml-auto text-xs text-fg-faint">{formatRelative(d.deployedAt)} · {d.deployedBy}</span>
                </li>
              ))}
            </ul>
          </Card>
          <p className="mt-2 text-xs text-fg-faint">
            Promotions and rollbacks live in <Link to="/deployments" className="text-accent hover:underline">Deployments & environments</Link>.
          </p>
        </TabsContent>

        <TabsContent value="compliance">
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCard label="Compliance score" value={`${app.complianceScore}%`} accent="var(--accent)" />
            <MetricCard label="Mapped findings" value={(findings ?? []).reduce((n, f) => n + f.complianceMappings.length, 0)} />
          </div>
          <Card className="mt-3">
            <CardHeader title="Framework impact from open findings" />
            <ul className="divide-y divide-line/60">
              {openFindings.flatMap((f) =>
                f.complianceMappings.map((m) => (
                  <li key={`${f.id}-${m.frameworkId}-${m.controlId}`} className="flex items-center gap-3 px-4 py-2.5">
                    <Badge color="var(--accent)">{titleCase(m.frameworkId)} {m.controlId}</Badge>
                    <Link to={`/security?finding=${f.id}`} className="min-w-0 flex-1 truncate text-sm text-fg hover:text-accent">{f.title}</Link>
                    <SeverityBadge severity={f.severity} />
                  </li>
                )),
              )}
            </ul>
          </Card>
        </TabsContent>

        <TabsContent value="observability">
          <div className="grid gap-3 sm:grid-cols-3">
            {app.slos.map((slo) => (
              <Card key={slo.metric} className="p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">{titleCase(slo.metric)}</p>
                <p className="mt-1.5 font-mono text-xl font-semibold text-fg">{slo.current}</p>
                <p className="mt-0.5 text-xs text-fg-faint">target {slo.target}</p>
                <Badge className="mt-2" color={slo.status === "met" ? "var(--ok)" : slo.status === "at-risk" ? "var(--warn)" : "var(--danger)"} dot>
                  {titleCase(slo.status)}
                </Badge>
              </Card>
            ))}
          </div>
          <p className="mt-3 text-xs text-fg-faint">
            Golden-signal dashboards live in Grafana / Azure Monitor (simulated integration) <ExternalLink size={11} className="inline" aria-hidden />.
          </p>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <ul className="divide-y divide-line/60">
              {(audit ?? [])
                .filter((e) => e.target.toLowerCase().includes(app.slug.split("-")[0] ?? "") || e.target.includes(appId) || (runs ?? []).some((r) => e.target.includes(r.id)))
                .slice(0, 12)
                .map((e) => (
                  <li key={e.id} className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Badge color={e.outcome === "success" ? "var(--ok)" : e.outcome === "denied" ? "var(--warn)" : "var(--danger)"}>{e.outcome}</Badge>
                      <span className="font-mono text-xs text-fg-muted">{e.action}</span>
                      <span className="ml-auto text-[11px] text-fg-faint">{formatDateTime(e.timestamp)}</span>
                    </div>
                    <p className="mt-1 text-sm text-fg">{e.detail}</p>
                  </li>
                ))}
            </ul>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card className="max-w-xl">
            <CardHeader title="Application settings" subtitle={`Visible read-only for role: ${titleCase(role)}`} />
            <CardBody>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-fg-faint">Argo CD application</dt><dd className="font-mono text-fg">{app.argoAppName}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-fg-faint">Repository</dt><dd className="font-mono text-fg">{repo?.name}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-fg-faint">Default branch</dt><dd className="font-mono text-fg">{repo?.defaultBranch}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-fg-faint">Owner</dt><dd className="text-fg">{userById(app.ownerUserId).name}</dd></div>
              </dl>
              <p className="mt-4 rounded-md border border-line bg-surface-2 p-3 text-xs text-fg-faint">
                Editing application settings requires the Administrator role and is performed through a change-managed pull request in this build.
              </p>
            </CardBody>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
