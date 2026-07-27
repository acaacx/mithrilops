import type { AIRecommendation } from "@secureflow/types";
import { Sparkles, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/misc";
import { titleCase } from "@/lib/utils";

const RISK_COLORS: Record<AIRecommendation["riskLevel"], string> = {
  critical: "var(--critical)",
  high: "var(--high)",
  medium: "var(--medium)",
  low: "var(--low)",
};

export function AIPanel({
  recommendation,
  loading = false,
}: {
  recommendation?: AIRecommendation;
  loading?: boolean;
}) {
  return (
    <Card className="relative overflow-hidden">
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-0.5"
        style={{ background: "linear-gradient(90deg, var(--accent), var(--info))" }}
      />
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Sparkles size={15} className="text-accent" aria-hidden />
        <h3 className="text-sm font-semibold tracking-tight">AI analysis</h3>
        <Badge color="var(--accent)" className="ml-auto">
          Simulated
        </Badge>
      </div>
      <div className="space-y-3 p-4">
        {loading || !recommendation ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-fg">{recommendation.title}</p>
              <Badge color={RISK_COLORS[recommendation.riskLevel]}>
                Risk: {titleCase(recommendation.riskLevel)}
              </Badge>
              <Badge color="var(--pending)">Confidence: {titleCase(recommendation.confidence)}</Badge>
            </div>
            <p className="text-sm text-fg-muted">{recommendation.summary}</p>
            <ul className="space-y-1.5">
              {recommendation.detail.map((d, i) => (
                <li key={i} className="flex gap-2 text-sm text-fg-muted">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
                  {d}
                </li>
              ))}
            </ul>
            <div className="rounded-md border border-line bg-surface-2 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">
                Suggested action
              </p>
              <p className="mt-1 text-sm text-fg">{recommendation.suggestedAction}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">
                  Supporting evidence
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-fg-muted">
                  {recommendation.supportingEvidence.map((e, i) => (
                    <li key={i} className="font-mono">
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">
                  Affected assets
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-fg-muted">
                  {recommendation.affectedAssets.map((a, i) => (
                    <li key={i} className="font-mono">
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="flex items-start gap-1.5 border-t border-line pt-3 text-xs text-fg-faint">
              <ShieldAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
              {recommendation.disclaimer}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

export function RiskScoreIndicator({ score, label }: { score: number; label?: string }) {
  const color =
    score >= 75 ? "var(--danger)" : score >= 50 ? "var(--warn)" : score >= 25 ? "var(--info)" : "var(--ok)";
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg width="68" height="68" viewBox="0 0 68 68" role="img" aria-label={`Risk score ${score} of 100`}>
        <circle cx="34" cy="34" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="6" />
        <circle
          cx="34"
          cy="34"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * score) / 100}
          transform="rotate(-90 34 34)"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
        <text
          x="34"
          y="38"
          textAnchor="middle"
          className="fill-fg font-mono"
          fontSize="15"
          fontWeight="600"
        >
          {score}
        </text>
      </svg>
      {label ? <p className="text-xs text-fg-muted">{label}</p> : null}
    </div>
  );
}
