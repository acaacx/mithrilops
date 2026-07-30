import { Link } from "react-router";
import { ArrowUpRight, GitBranch, ShieldCheck } from "lucide-react";
import { repositories, teams, userById } from "@secureflow/mock-data";
import { PageHeader } from "@/components/domain/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/misc";
import { Progress } from "@/components/ui/misc";
import { useApplications } from "@/lib/queries";
import { formatRelative, titleCase } from "@/lib/utils";

const DEPLOY_COLORS: Record<string, string> = {
  healthy: "var(--ok)",
  degraded: "var(--warn)",
  progressing: "var(--info)",
  failed: "var(--danger)",
  "rolled-back": "var(--warn)",
};

export default function ApplicationsPage() {
  const { data: apps, isLoading } = useApplications();

  return (
    <div className="mx-auto max-w-[1500px] p-6 rise-in">
      <PageHeader
        title="Applications"
        subtitle="Every service under SecureFlow governance, with live posture"
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-64" />)
          : (apps ?? []).map((app) => {
              const repo = repositories.find((r) => r.id === app.repositoryId);
              const team = teams.find((t) => t.id === app.teamId);
              const owner = userById(app.ownerUserId);
              const vulnTotal =
                app.openVulnerabilities.critical +
                app.openVulnerabilities.high +
                app.openVulnerabilities.medium +
                app.openVulnerabilities.low;
              return (
                <Link key={app.id} to={`/applications/${app.id}`} className="group">
                  <Card className="flex h-full flex-col p-4 transition-all duration-150 group-hover:border-line-strong group-hover:shadow-lg">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="flex items-center gap-1.5 text-base font-semibold tracking-tight text-fg">
                          {app.name}
                          <ArrowUpRight size={14} className="text-fg-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                        </h2>
                        <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{app.description}</p>
                      </div>
                      <Badge color={DEPLOY_COLORS[app.deploymentStatus] ?? "var(--pending)"} dot pulse={app.deploymentStatus === "progressing"}>
                        {titleCase(app.deploymentStatus)}
                      </Badge>
                    </div>

                    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                      <div className="flex justify-between gap-2"><dt className="text-fg-faint">Version</dt><dd className="font-mono text-fg">{app.currentVersion}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-fg-faint">Availability</dt><dd className="font-mono text-fg">{app.availability}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-fg-faint">Owner</dt><dd className="truncate text-fg-muted">{owner.name}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-fg-faint">Team</dt><dd className="truncate text-fg-muted">{team?.name}</dd></div>
                      <div className="col-span-2 flex justify-between gap-2">
                        <dt className="text-fg-faint">Repository</dt>
                        <dd className="truncate font-mono text-fg-muted">{repo?.name}</dd>
                      </div>
                      <div className="col-span-2 flex justify-between gap-2">
                        <dt className="text-fg-faint">Stack</dt>
                        <dd className="truncate text-fg-muted">{app.technology.join(" · ")}</dd>
                      </div>
                    </dl>

                    <div className="mt-3 space-y-2">
                      <div>
                        <div className="mb-1 flex justify-between text-[11px]">
                          <span className="text-fg-faint">Security score</span>
                          <span className="font-mono text-fg">{app.securityScore}</span>
                        </div>
                        <Progress value={app.securityScore} color={app.securityScore >= 80 ? "var(--ok)" : app.securityScore >= 65 ? "var(--warn)" : "var(--danger)"} />
                      </div>
                      <div>
                        <div className="mb-1 flex justify-between text-[11px]">
                          <span className="text-fg-faint">Compliance score</span>
                          <span className="font-mono text-fg">{app.complianceScore}</span>
                        </div>
                        <Progress value={app.complianceScore} color="var(--accent)" />
                      </div>
                    </div>

                    <div className="mt-auto flex items-center gap-2 border-t border-line pt-3 text-[11px] text-fg-faint" style={{ marginTop: "auto" }}>
                      <GitBranch size={12} aria-hidden />
                      <Badge color={app.pipelineHealth === "healthy" ? "var(--ok)" : app.pipelineHealth === "unstable" ? "var(--warn)" : "var(--danger)"}>
                        {titleCase(app.pipelineHealth)}
                      </Badge>
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck size={12} aria-hidden />
                        {vulnTotal} open
                        {app.openVulnerabilities.critical > 0 && (
                          <span className="font-mono text-critical">({app.openVulnerabilities.critical}C)</span>
                        )}
                      </span>
                      <span className="ml-auto">Deployed {formatRelative(app.lastDeploymentAt)}</span>
                    </div>
                  </Card>
                </Link>
              );
            })}
      </div>
    </div>
  );
}
