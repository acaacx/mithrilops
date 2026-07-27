import type { PipelineRunStatus, Severity, StageStatus } from "@secureflow/types";
import { Badge } from "@/components/ui/badge";
import { titleCase } from "@/lib/utils";

const RUN_STATUS_COLORS: Record<PipelineRunStatus, string> = {
  succeeded: "var(--ok)",
  running: "var(--info)",
  failed: "var(--danger)",
  blocked: "var(--blocked)",
  "waiting-approval": "var(--warn)",
  "rolled-back": "var(--warn)",
  cancelled: "var(--pending)",
};

const STAGE_STATUS_COLORS: Record<StageStatus, string> = {
  pending: "var(--pending)",
  running: "var(--info)",
  succeeded: "var(--ok)",
  failed: "var(--danger)",
  skipped: "var(--pending)",
  blocked: "var(--blocked)",
  "waiting-approval": "var(--warn)",
};

export function runStatusColor(status: PipelineRunStatus): string {
  return RUN_STATUS_COLORS[status];
}

export function stageStatusColor(status: StageStatus): string {
  return STAGE_STATUS_COLORS[status];
}

export function StatusBadge({ status }: { status: PipelineRunStatus }) {
  return (
    <Badge color={RUN_STATUS_COLORS[status]} dot pulse={status === "running"}>
      {titleCase(status)}
    </Badge>
  );
}

export function StageStatusBadge({ status }: { status: StageStatus }) {
  return (
    <Badge color={STAGE_STATUS_COLORS[status]} dot pulse={status === "running"}>
      {titleCase(status)}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge color={`var(--${severity})`}>{titleCase(severity)}</Badge>;
}

export function GateBadge({ gate }: { gate: "passed" | "failed" | "in-progress" | "waived" }) {
  const color =
    gate === "passed"
      ? "var(--ok)"
      : gate === "failed"
        ? "var(--danger)"
        : gate === "waived"
          ? "var(--warn)"
          : "var(--info)";
  return (
    <Badge color={color} dot pulse={gate === "in-progress"}>
      {titleCase(gate)}
    </Badge>
  );
}
