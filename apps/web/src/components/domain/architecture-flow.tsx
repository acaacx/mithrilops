import { useMemo, useState } from "react";
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
  Box,
  Cloud,
  Container,
  Eye,
  FileCode2,
  Fingerprint,
  GitBranch,
  KeyRound,
  Scale,
  Shield,
  Workflow,
} from "lucide-react";
import type { ArchitectureDiagram, ArchitectureNodeData } from "@secureflow/types";
import { STAGE_DEFINITIONS } from "@secureflow/mock-data";
import { cn, titleCase } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const KIND_ICONS: Record<string, typeof Box> = {
  scm: GitBranch,
  ci: Workflow,
  iac: FileCode2,
  registry: Container,
  compute: Cloud,
  cd: Workflow,
  secrets: KeyRound,
  identity: Fingerprint,
  observability: Eye,
  governance: Scale,
  security: Shield,
};

const STATUS_COLORS: Record<ArchitectureNodeData["status"], string> = {
  healthy: "var(--ok)",
  warning: "var(--warn)",
  critical: "var(--danger)",
  unknown: "var(--pending)",
};

/** Hand-tuned layout keyed by node id; unknown ids fall into a grid. */
const POSITIONS: Record<string, { x: number; y: number }> = {
  github: { x: 0, y: 180 },
  actions: { x: 250, y: 180 },
  terraform: { x: 500, y: 60 },
  acr: { x: 500, y: 300 },
  argocd: { x: 500, y: 180 },
  aks: { x: 780, y: 180 },
  compute: { x: 780, y: 180 },
  keyvault: { x: 780, y: 40 },
  entra: { x: 780, y: 330 },
  azpolicy: { x: 1060, y: 40 },
  defender: { x: 1060, y: 330 },
  prometheus: { x: 1060, y: 130 },
  grafana: { x: 1310, y: 130 },
  azmonitor: { x: 1060, y: 240 },
  monitor: { x: 1060, y: 180 },
  loganalytics: { x: 1310, y: 240 },
  appinsights: { x: 1310, y: 330 },
  policy: { x: 1060, y: 40 },
};

type ArchNodeType = Node<{ item: ArchitectureNodeData; selected: boolean }, "arch">;

function ArchNode({ data }: NodeProps<ArchNodeType>) {
  const { item, selected } = data;
  const Icon = KIND_ICONS[item.kind] ?? Box;
  const color = STATUS_COLORS[item.status];
  return (
    <div
      className={cn(
        "w-[210px] rounded-md border bg-surface px-3 py-2.5 transition-shadow",
        selected ? "shadow-[0_0_0_2px_var(--accent)]" : "hover:shadow-lg",
      )}
      style={{ borderColor: `color-mix(in oklab, ${color} 45%, var(--line))` }}
    >
      <Handle type="target" position={Position.Left} className="!bg-line-strong !border-0 !h-1.5 !w-1.5" />
      <div className="flex items-center gap-2">
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded"
          style={{ background: `color-mix(in oklab, ${color} 14%, transparent)`, color }}
        >
          <Icon size={14} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-fg">{item.label}</p>
          <p className="text-[10px] uppercase tracking-wider text-fg-faint">{item.kind}</p>
        </div>
        {item.findingsCount > 0 && (
          <span
            className="ml-auto shrink-0 rounded-full px-1.5 font-mono text-[10px] font-semibold"
            style={{ background: "color-mix(in oklab, var(--warn) 16%, transparent)", color: "var(--warn)" }}
            aria-label={`${item.findingsCount} findings`}
          >
            {item.findingsCount}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-line-strong !border-0 !h-1.5 !w-1.5" />
    </div>
  );
}

const nodeTypes = { arch: ArchNode };

export function ArchitectureFlow({ diagram }: { diagram: ArchitectureDiagram }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = diagram.nodes.find((n) => n.id === selectedId) ?? null;

  const { nodes, edges } = useMemo(() => {
    const nodes: ArchNodeType[] = diagram.nodes.map((item, i) => ({
      id: item.id,
      type: "arch",
      position: POSITIONS[item.id] ?? { x: (i % 5) * 260, y: Math.floor(i / 5) * 120 },
      data: { item, selected: item.id === selectedId },
      draggable: true,
    }));
    const edges: Edge[] = diagram.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      labelStyle: { fill: "var(--fg-faint)", fontSize: 10 },
      labelBgStyle: { fill: "var(--surface)", fillOpacity: 0.85 },
      style: { strokeWidth: 1.5 },
    }));
    return { nodes, edges };
  }, [diagram, selectedId]);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <div className="h-[520px] rounded-lg border border-line bg-canvas" role="group" aria-label="Architecture diagram">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_e, node) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId(null)}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.3}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          nodesConnectable={false}
        >
          <Background gap={28} size={1} color="color-mix(in oklab, var(--line) 60%, transparent)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <aside className="rounded-lg border border-line bg-surface p-4" aria-live="polite">
        {selected ? (
          <div className="space-y-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-fg">{selected.label}</h3>
                <Badge color={STATUS_COLORS[selected.status]} dot>
                  {titleCase(selected.status)}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-fg-muted">{selected.description}</p>
            </div>
            <dl className="space-y-1.5 text-xs">
              <div className="flex justify-between gap-3"><dt className="text-fg-faint">Owner</dt><dd className="text-fg">{selected.owner}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-fg-faint">Security findings</dt><dd className={cn("font-mono", selected.findingsCount > 0 ? "text-warn" : "text-fg")}>{selected.findingsCount}</dd></div>
            </dl>
            {selected.dependencies.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">Depends on</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {selected.dependencies.map((d) => (
                    <button
                      key={d}
                      onClick={() => setSelectedId(d)}
                      className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted hover:text-fg cursor-pointer"
                    >
                      {diagram.nodes.find((n) => n.id === d)?.label ?? d}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {selected.relatedStageDefinitionIds.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">Related pipeline stages</p>
                <ul className="mt-1 space-y-1 text-xs text-fg-muted">
                  {selected.relatedStageDefinitionIds.map((id) => (
                    <li key={id}>• {STAGE_DEFINITIONS.find((s) => s.id === id)?.name ?? id}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full min-h-40 items-center justify-center text-center text-sm text-fg-faint">
            Select a component to inspect its status, ownership, findings, and pipeline links.
          </div>
        )}
      </aside>
    </div>
  );
}
