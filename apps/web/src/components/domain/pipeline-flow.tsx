import { useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Clock4,
  Loader2,
  OctagonX,
  ShieldQuestion,
} from "lucide-react";
import type { PipelineStage } from "@secureflow/types";
import { cn, formatDuration } from "@/lib/utils";
import { stageStatusColor } from "./badges";

const PER_ROW = 6;
const NODE_W = 190;
const NODE_H = 74;
const GAP_X = 44;
const GAP_Y = 56;

type StageNodeType = Node<{ stage: PipelineStage; selected: boolean }, "stage">;

function StatusIcon({ stage }: { stage: PipelineStage }) {
  const cls = "shrink-0";
  switch (stage.status) {
    case "succeeded":
      return <CheckCircle2 size={14} className={cls} style={{ color: "var(--ok)" }} aria-hidden />;
    case "failed":
      return <OctagonX size={14} className={cls} style={{ color: "var(--danger)" }} aria-hidden />;
    case "blocked":
      return <CircleSlash size={14} className={cls} style={{ color: "var(--blocked)" }} aria-hidden />;
    case "running":
      return <Loader2 size={14} className={cn(cls, "animate-spin")} style={{ color: "var(--info)" }} aria-hidden />;
    case "waiting-approval":
      return <ShieldQuestion size={14} className={cls} style={{ color: "var(--warn)" }} aria-hidden />;
    case "skipped":
      return <CircleDashed size={14} className={cls} style={{ color: "var(--pending)" }} aria-hidden />;
    default:
      return <Clock4 size={14} className={cls} style={{ color: "var(--pending)" }} aria-hidden />;
  }
}

function StageNode({ data }: NodeProps<StageNodeType>) {
  const { stage, selected } = data;
  const color = stageStatusColor(stage.status);
  return (
    <div
      className={cn(
        "rounded-md border bg-surface px-3 py-2 transition-shadow",
        selected ? "shadow-[0_0_0_2px_var(--accent)]" : "hover:shadow-lg",
      )}
      style={{
        width: NODE_W,
        height: NODE_H,
        borderColor: `color-mix(in oklab, ${color} 55%, var(--line))`,
        opacity: stage.status === "skipped" ? 0.55 : 1,
      }}
    >
      <Handle type="target" position={Position.Left} className="!bg-line-strong !border-0 !h-1.5 !w-1.5" />
      <div className="flex items-center gap-1.5">
        <StatusIcon stage={stage} />
        <p className="truncate text-xs font-medium text-fg">{stage.name}</p>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-fg-faint">
        <span className="truncate">{stage.tool}</span>
        <span className="font-mono">{formatDuration(stage.durationSeconds)}</span>
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        {stage.blocksDeployment && (
          <span className="rounded-sm bg-surface-3 px-1 py-px text-[9px] uppercase tracking-wide text-fg-faint">gate</span>
        )}
        {stage.findings.length > 0 && (
          <span
            className="rounded-sm px-1 py-px font-mono text-[9px] font-semibold"
            style={{ background: "color-mix(in oklab, var(--danger) 18%, transparent)", color: "var(--danger)" }}
          >
            {stage.findings.length} finding{stage.findings.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-line-strong !border-0 !h-1.5 !w-1.5" />
    </div>
  );
}

const nodeTypes = { stage: StageNode };

export function PipelineFlow({
  stages,
  selectedStageId,
  onSelect,
}: {
  stages: PipelineStage[];
  selectedStageId: string | null;
  onSelect: (stageId: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const nodes: StageNodeType[] = stages.map((stage, i) => {
      const row = Math.floor(i / PER_ROW);
      const colRaw = i % PER_ROW;
      // Serpentine layout: odd rows flow right-to-left so edges stay short.
      const col = row % 2 === 0 ? colRaw : PER_ROW - 1 - colRaw;
      return {
        id: stage.id,
        type: "stage",
        position: { x: col * (NODE_W + GAP_X), y: row * (NODE_H + GAP_Y) },
        data: { stage, selected: stage.id === selectedStageId },
        draggable: false,
      };
    });
    const edges: Edge[] = stages.slice(1).map((stage, i) => {
      const prev = stages[i]!;
      return {
        id: `${prev.id}->${stage.id}`,
        source: prev.id,
        target: stage.id,
        animated: stage.status === "running",
        style: { strokeWidth: 1.5 },
      };
    });
    return { nodes, edges };
  }, [stages, selectedStageId]);

  return (
    <div className="h-[560px] rounded-lg border border-line bg-canvas" role="group" aria-label="Pipeline stage graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_e, node) => onSelect(node.id)}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.3}
        maxZoom={1.4}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
      >
        <Background gap={28} size={1} color="color-mix(in oklab, var(--line) 60%, transparent)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
