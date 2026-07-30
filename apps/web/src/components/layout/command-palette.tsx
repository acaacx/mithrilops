import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Boxes, GitBranch, Search, ShieldHalf } from "lucide-react";
import { applications, pipelineRuns, securityFindings } from "@secureflow/mock-data";
import { shortSha } from "@/lib/utils";

interface Result {
  id: string;
  label: string;
  hint: string;
  to: string;
  kind: "application" | "run" | "finding";
}

const KIND_ICON = { application: Boxes, run: GitBranch, finding: ShieldHalf };

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const apps: Result[] = applications
      .filter((a) => a.name.toLowerCase().includes(q) || a.slug.includes(q))
      .map((a) => ({
        id: a.id,
        label: a.name,
        hint: a.cloudEnvironment,
        to: `/applications/${a.id}`,
        kind: "application" as const,
      }));
    const runs: Result[] = pipelineRuns
      .filter(
        (r) =>
          r.id.toLowerCase().includes(q) ||
          r.commit.branch.toLowerCase().includes(q) ||
          r.commit.message.toLowerCase().includes(q),
      )
      .map((r) => ({
        id: r.id,
        label: `${r.id} — ${r.commit.message}`,
        hint: `${r.commit.branch} @ ${shortSha(r.commit.sha)}`,
        to: `/pipelines/${r.id}`,
        kind: "run" as const,
      }));
    const findings: Result[] = securityFindings
      .filter((f) => f.title.toLowerCase().includes(q) || f.ruleId.toLowerCase().includes(q))
      .map((f) => ({
        id: f.id,
        label: f.title,
        hint: `${f.severity} · ${f.scanner}`,
        to: `/security?finding=${f.id}`,
        kind: "finding" as const,
      }));
    return [...apps, ...runs, ...findings].slice(0, 10);
  }, [query]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <DialogPrimitive.Content className="fixed left-1/2 top-24 z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-line-strong bg-surface shadow-2xl focus:outline-none">
          <DialogPrimitive.Title className="sr-only">Global search</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b border-line px-4">
            <Search size={15} className="text-fg-faint" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search applications, pipeline runs, findings…"
              aria-label="Global search"
              className="h-12 w-full bg-transparent text-sm text-fg placeholder:text-fg-faint focus:outline-none"
            />
            <kbd className="rounded border border-line bg-surface-2 px-1.5 font-mono text-[10px] text-fg-faint">
              esc
            </kbd>
          </div>
          <div className="max-h-80 overflow-y-auto p-1.5 thin-scroll">
            {query && results.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-fg-faint">
                No matches for “{query}”.
              </p>
            ) : (
              results.map((r) => {
                const Icon = KIND_ICON[r.kind];
                return (
                  <button
                    key={`${r.kind}-${r.id}`}
                    onClick={() => {
                      onOpenChange(false);
                      setQuery("");
                      navigate(r.to);
                    }}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-surface-2 cursor-pointer"
                  >
                    <Icon size={15} className="shrink-0 text-fg-faint" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">{r.label}</span>
                      <span className="block truncate font-mono text-xs text-fg-faint">{r.hint}</span>
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-fg-faint">{r.kind}</span>
                  </button>
                );
              })
            )}
            {!query && (
              <p className="px-3 py-8 text-center text-sm text-fg-faint">
                Type to search across the platform.
              </p>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
