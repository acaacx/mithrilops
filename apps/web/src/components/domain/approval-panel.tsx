import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, ShieldQuestion, XCircle } from "lucide-react";
import {
  approvalRequestSchema,
  type ApprovalRequest,
  type Approval,
  type PipelineRun,
} from "@secureflow/types";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, Label, Textarea } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/misc";
import { useApproveDeployment } from "@/lib/queries";
import { useCan } from "@/stores/session";
import { formatDateTime, titleCase } from "@/lib/utils";

export function ApprovalPanel({ run, approvals }: { run: PipelineRun; approvals: Approval[] }) {
  const canApprove = useCan("deployment.approve");
  const canReject = useCan("deployment.reject");
  const canRequestChanges = useCan("deployment.request-changes");
  const [decision, setDecision] = useState<ApprovalRequest["decision"] | null>(null);
  const approve = useApproveDeployment(run.id);

  const form = useForm<ApprovalRequest>({
    resolver: zodResolver(approvalRequestSchema),
    defaultValues: { decision: "approved", comment: "", environment: run.environment },
  });

  const pending = run.approvalStatus === "pending" && (run.status === "waiting-approval" || run.status === "blocked");

  const openDialog = (d: ApprovalRequest["decision"]) => {
    form.reset({ decision: d, comment: "", environment: run.environment });
    setDecision(d);
  };

  const submit = form.handleSubmit((values) => {
    approve.mutate(values);
    setDecision(null);
  });

  const disabledHint = (allowed: boolean) =>
    allowed ? null : "Your current role does not hold this permission (RBAC).";

  return (
    <Card>
      <CardHeader
        title="Approvals"
        subtitle={`Environment: ${titleCase(run.environment)}`}
        actions={
          pending ? (
            <Badge color="var(--warn)" dot pulse>
              Decision required
            </Badge>
          ) : (
            <Badge color={run.approvalStatus === "approved" ? "var(--ok)" : run.approvalStatus === "rejected" ? "var(--danger)" : "var(--pending)"}>
              {titleCase(run.approvalStatus)}
            </Badge>
          )
        }
      />
      <div className="p-4">
        <ul className="space-y-3">
          {approvals.length === 0 && (
            <li className="text-sm text-fg-faint">No approval requirements recorded for this run.</li>
          )}
          {approvals.map((a) => (
            <li key={a.id} className="flex items-start gap-2.5">
              {a.decision === "approved" ? (
                <CheckCircle2 size={15} className="mt-0.5 shrink-0" style={{ color: "var(--ok)" }} aria-hidden />
              ) : a.decision === "rejected" ? (
                <XCircle size={15} className="mt-0.5 shrink-0" style={{ color: "var(--danger)" }} aria-hidden />
              ) : (
                <ShieldQuestion size={15} className="mt-0.5 shrink-0" style={{ color: "var(--warn)" }} aria-hidden />
              )}
              <div className="min-w-0">
                <p className="text-sm text-fg">
                  {titleCase(a.requiredRole)} — {titleCase(a.decision)}
                </p>
                {a.decidedBy ? (
                  <p className="text-xs text-fg-muted">
                    {a.decidedBy} · {formatDateTime(a.decidedAt)}
                  </p>
                ) : (
                  <p className="text-xs text-fg-faint">Awaiting decision</p>
                )}
                {a.comment && <p className="mt-1 text-xs italic text-fg-muted">“{a.comment}”</p>}
              </div>
            </li>
          ))}
        </ul>

        {pending && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            {(
              [
                { d: "approved" as const, label: "Approve", allowed: canApprove, variant: "primary" as const },
                { d: "rejected" as const, label: "Reject", allowed: canReject, variant: "danger" as const },
                { d: "changes-requested" as const, label: "Request changes", allowed: canRequestChanges, variant: "secondary" as const },
              ]
            ).map(({ d, label, allowed, variant }) => {
              const btn = (
                <Button key={d} variant={variant} disabled={!allowed || approve.isPending} onClick={() => openDialog(d)}>
                  {label}
                </Button>
              );
              const hint = disabledHint(allowed);
              return hint ? (
                <Tooltip key={d} label={hint}>
                  <span tabIndex={0}>{btn}</span>
                </Tooltip>
              ) : (
                btn
              );
            })}
          </div>
        )}
      </div>

      <Dialog
        open={decision !== null}
        onOpenChange={(o) => !o && setDecision(null)}
        title={decision === "approved" ? "Approve deployment" : decision === "rejected" ? "Reject deployment" : "Request changes"}
        description={`${run.id} · ${run.artifactVersion} → ${titleCase(run.environment)}. Your decision and justification are written to the immutable audit log.`}
      >
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label htmlFor="approval-comment">Justification (required)</Label>
            <Textarea
              id="approval-comment"
              placeholder="Why is this decision correct? Reference findings, evidence, or policy."
              {...form.register("comment")}
            />
            <FieldError message={form.formState.errors.comment?.message} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            <Button type="submit" variant={decision === "rejected" ? "danger" : "primary"} disabled={approve.isPending}>
              Confirm {decision === "approved" ? "approval" : decision === "rejected" ? "rejection" : "request"}
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
