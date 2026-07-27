import { Fragment, useState } from "react";
import { ArrowRight, RefreshCcw, Undo2 } from "lucide-react";
import { ENVIRONMENTS, type Deployment, type EnvironmentName } from "@secureflow/types";
import { applications } from "@secureflow/mock-data";
import { PageHeader } from "@/components/domain/page-header";
import { GateBadge } from "@/components/domain/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog, Progress, Skeleton, Tooltip } from "@/components/ui/misc";
import { useDeployments, usePromote, useRollback, useSyncApplication } from "@/lib/queries";
import { cn, formatRelative, titleCase } from "@/lib/utils";
import { useCan } from "@/stores/session";

const STATUS_COLORS: Record<Deployment["status"], string> = {
  healthy: "var(--ok)",
  degraded: "var(--warn)",
  progressing: "var(--info)",
  failed: "var(--danger)",
  "rolled-back": "var(--warn)",
};

const SYNC_COLORS: Record<Deployment["argoSyncStatus"], string> = {
  synced: "var(--ok)",
  "out-of-sync": "var(--warn)",
  syncing: "var(--info)",
  unknown: "var(--pending)",
};

export default function DeploymentsPage() {
  const { data: deployments, isLoading } = useDeployments();

  return (
    <div className="mx-auto max-w-[1500px] p-6 rise-in">
      <PageHeader
        title="Deployments & environments"
        subtitle="Environment progression, Argo CD sync, and rollback control per application"
      />
      <div className="space-y-4">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-44" />)
          : applications.map((app) => (
              <ApplicationRow
                key={app.id}
                appId={app.id}
                appName={app.name}
                deployments={(deployments ?? []).filter((d) => d.applicationId === app.id)}
              />
            ))}
      </div>
    </div>
  );
}

function ApplicationRow({
  appId,
  appName,
  deployments,
}: {
  appId: string;
  appName: string;
  deployments: Deployment[];
}) {
  const canPromote = useCan("deployment.promote");
  const canRollback = useCan("deployment.rollback");
  const promote = usePromote(appId);
  const rollback = useRollback(appId);
  const sync = useSyncApplication(appId);
  const [confirm, setConfirm] = useState<{ kind: "promote"; env: EnvironmentName } | { kind: "rollback"; revision: string } | null>(null);

  const byEnv = (env: EnvironmentName) => deployments.find((d) => d.environment === env);
  const prod = byEnv("production");

  return (
    <Card>
      <CardHeader
        title={appName}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => sync.mutate()} disabled={sync.isPending} aria-label={`Sync ${appName} in Argo CD`}>
              <RefreshCcw size={13} className={sync.isPending ? "animate-spin" : ""} /> Argo sync
            </Button>
            {prod?.previousVersion && (
              <Tooltip label={canRollback ? `Roll production back to ${prod.previousVersion}` : "Requires deployment.rollback (RBAC)"}>
                <span tabIndex={0}>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={!canRollback || rollback.isPending}
                    onClick={() => setConfirm({ kind: "rollback", revision: prod.previousVersion! })}
                  >
                    <Undo2 size={13} /> Rollback prod
                  </Button>
                </span>
              </Tooltip>
            )}
          </>
        }
      />
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
        {ENVIRONMENTS.map((env, i) => {
          const dep = byEnv(env);
          const next = ENVIRONMENTS[i + 1];
          const nextDep = next ? byEnv(next) : undefined;
          const promotable = Boolean(
            next && dep && nextDep && dep.version !== nextDep.version && dep.status === "healthy" && dep.securityGate === "passed",
          );
          return (
            <Fragment key={env}>
              <div className="relative rounded-lg border border-line bg-surface-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">{titleCase(env)}</p>
                  {dep && (
                    <Badge color={STATUS_COLORS[dep.status]} dot pulse={dep.status === "progressing"}>
                      {titleCase(dep.status)}
                    </Badge>
                  )}
                </div>
                {dep ? (
                  <>
                    <p className="mt-2 font-mono text-base font-semibold text-fg">{dep.version}</p>
                    {dep.previousVersion && (
                      <p className="text-[11px] text-fg-faint">rollback target: <span className="font-mono">{dep.previousVersion}</span></p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge color={SYNC_COLORS[dep.argoSyncStatus]} dot pulse={dep.argoSyncStatus === "syncing"}>
                        {titleCase(dep.argoSyncStatus)}
                      </Badge>
                      <GateBadge gate={dep.securityGate} />
                      <Badge color="var(--pending)">{titleCase(dep.strategy)}</Badge>
                    </div>
                    {dep.strategy === "canary" && dep.canaryPercent !== undefined && (
                      <div className="mt-2">
                        <div className="mb-1 flex justify-between text-[10px] text-fg-faint">
                          <span>Canary traffic</span>
                          <span className="font-mono">{dep.canaryPercent}%</span>
                        </div>
                        <Progress value={dep.canaryPercent} color="var(--info)" />
                      </div>
                    )}
                    {dep.strategy === "blue-green" && (
                      <div className="mt-2 flex gap-1" aria-label="Blue/green slots">
                        <span className="h-1.5 flex-1 rounded-full" style={{ background: "var(--info)" }} title="Blue (active)" />
                        <span className="h-1.5 flex-1 rounded-full bg-surface-3" title="Green (standby)" />
                      </div>
                    )}
                    <p className="mt-2 text-[11px] text-fg-faint">
                      {formatRelative(dep.deployedAt)} · {dep.deployedBy}
                    </p>
                    {promotable && next && (
                      <Tooltip label={canPromote ? `Promote ${dep.version} to ${titleCase(next)}` : "Requires deployment.promote (RBAC)"}>
                        <span tabIndex={0} className="mt-2 block">
                          <Button
                            size="sm"
                            variant="primary"
                            className="w-full justify-center"
                            disabled={!canPromote || promote.isPending}
                            onClick={() => setConfirm({ kind: "promote", env: next })}
                          >
                            Promote <ArrowRight size={13} /> {titleCase(next)}
                          </Button>
                        </span>
                      </Tooltip>
                    )}
                  </>
                ) : (
                  <p className={cn("mt-2 text-sm text-fg-faint")}>Not deployed</p>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.kind === "promote" ? "Promote release" : "Roll back production"}
        message={
          confirm?.kind === "promote"
            ? `Promote ${appName} to ${titleCase(confirm.env)}? The security gate result carries forward and the promotion is audited.`
            : `Roll ${appName} production back to ${confirm?.kind === "rollback" ? confirm.revision : ""}? Traffic shifts immediately and the action is audited.`
        }
        confirmLabel={confirm?.kind === "promote" ? "Promote" : "Roll back"}
        destructive={confirm?.kind === "rollback"}
        onConfirm={() => {
          if (confirm?.kind === "promote") promote.mutate(confirm.env);
          if (confirm?.kind === "rollback") rollback.mutate(confirm.revision);
        }}
      />
    </Card>
  );
}
