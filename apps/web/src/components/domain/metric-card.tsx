import type { ReactNode } from "react";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function MetricCard({
  label,
  value,
  trend,
  trendLabel,
  trendGood,
  icon,
  accent,
}: {
  label: string;
  value: ReactNode;
  trend?: "up" | "down" | "flat";
  trendLabel?: string;
  trendGood?: boolean;
  icon?: ReactNode;
  accent?: string;
}) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  return (
    <Card className="relative overflow-hidden p-4">
      {accent ? (
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-0.5"
          style={{ background: accent }}
        />
      ) : null}
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">{label}</p>
        {icon ? <span className="text-fg-faint">{icon}</span> : null}
      </div>
      <p className="mt-1.5 font-mono text-2xl font-semibold tracking-tight text-fg">{value}</p>
      {trend && trendLabel ? (
        <p
          className={cn(
            "mt-1 flex items-center gap-1 text-xs",
            trendGood === undefined ? "text-fg-muted" : trendGood ? "text-ok" : "text-danger",
          )}
        >
          <TrendIcon size={13} aria-hidden />
          {trendLabel}
        </p>
      ) : null}
    </Card>
  );
}
