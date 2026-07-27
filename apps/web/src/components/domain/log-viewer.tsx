import { useEffect, useRef } from "react";
import type { PipelineLogLine } from "@secureflow/types";
import { cn } from "@/lib/utils";

const LEVEL_COLORS: Record<PipelineLogLine["level"], string> = {
  info: "text-fg-muted",
  warn: "text-warn",
  error: "text-danger",
  debug: "text-fg-faint",
};

export function LogViewer({
  lines,
  follow = false,
  className,
}: {
  lines: PipelineLogLine[];
  follow?: boolean;
  className?: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (follow) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [lines.length, follow]);

  return (
    <div
      role="log"
      aria-label="Stage logs"
      className={cn(
        "max-h-72 overflow-auto rounded-md border border-line bg-[#070a10] p-3 font-mono text-xs leading-5 thin-scroll",
        className,
      )}
    >
      {lines.length === 0 ? (
        <p className="text-fg-faint">No log output for this stage yet.</p>
      ) : (
        lines.map((line, i) => (
          <div key={i} className="flex gap-3 whitespace-pre-wrap break-all">
            <span className="shrink-0 select-none text-fg-faint">
              {new Date(line.timestamp).toLocaleTimeString(undefined, { hour12: false })}
            </span>
            <span className={cn("shrink-0 w-11 uppercase", LEVEL_COLORS[line.level])}>
              {line.level}
            </span>
            <span className={LEVEL_COLORS[line.level]}>{line.message}</span>
          </div>
        ))
      )}
      <div ref={endRef} />
    </div>
  );
}

export function CodeViewer({ code, className }: { code: string; className?: string }) {
  return (
    <pre
      className={cn(
        "overflow-auto rounded-md border border-line bg-[#070a10] p-3 font-mono text-xs leading-5 text-fg-muted thin-scroll",
        className,
      )}
    >
      <code>{code}</code>
    </pre>
  );
}

export function DiffViewer({
  before,
  after,
  beforeTitle = "Previous",
  afterTitle = "Proposed",
}: {
  before: string;
  after: string;
  beforeTitle?: string;
  afterTitle?: string;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">
          {beforeTitle}
        </p>
        <pre className="max-h-96 overflow-auto rounded-md border border-danger/25 bg-[#070a10] p-3 font-mono text-xs leading-5 thin-scroll">
          {before.split("\n").map((l, i) => (
            <div key={i} className={l.startsWith("-") ? "bg-danger/15 text-danger" : "text-fg-muted"}>
              {l || " "}
            </div>
          ))}
        </pre>
      </div>
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">
          {afterTitle}
        </p>
        <pre className="max-h-96 overflow-auto rounded-md border border-ok/25 bg-[#070a10] p-3 font-mono text-xs leading-5 thin-scroll">
          {after.split("\n").map((l, i) => (
            <div key={i} className={l.startsWith("+") ? "bg-ok/15 text-ok" : "text-fg-muted"}>
              {l || " "}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
