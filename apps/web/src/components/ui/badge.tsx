import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  color = "var(--pending)",
  dot = false,
  pulse = false,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  color?: string;
  dot?: boolean;
  pulse?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap",
        className,
      )}
      style={{
        color,
        borderColor: `color-mix(in oklab, ${color} 40%, transparent)`,
        background: `color-mix(in oklab, ${color} 12%, transparent)`,
      }}
      {...props}
    >
      {dot ? (
        <span
          className={cn("h-1.5 w-1.5 rounded-full", pulse && "pulse-dot")}
          style={{ background: color }}
          aria-hidden
        />
      ) : null}
      {children}
    </span>
  );
}
