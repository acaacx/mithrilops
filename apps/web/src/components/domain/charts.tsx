import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardHeader } from "@/components/ui/card";

const axisProps = {
  stroke: "var(--fg-faint)",
  fontSize: 11,
  tickLine: false,
  axisLine: { stroke: "var(--line)" },
} as const;

const tooltipStyle = {
  contentStyle: {
    background: "var(--surface-2)",
    border: "1px solid var(--line-strong)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--fg)",
  },
  labelStyle: { color: "var(--fg-muted)" },
  cursor: { fill: "color-mix(in oklab, var(--line) 30%, transparent)" },
} as const;

export function ChartCard({
  title,
  subtitle,
  height = 220,
  children,
}: {
  title: string;
  subtitle?: string;
  height?: number;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <div className="p-3" style={{ height }}>
        {children}
      </div>
    </Card>
  );
}

export function TrendArea({
  data,
  dataKey,
  color = "var(--accent)",
  xKey = "label",
}: {
  data: Record<string, string | number>[];
  dataKey: string;
  color?: string;
  xKey?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} width={38} />
        <Tooltip {...tooltipStyle} />
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#grad-${dataKey})`} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MultiLine({
  data,
  series,
  xKey = "label",
}: {
  data: Record<string, string | number>[];
  series: { key: string; color: string }[];
  xKey?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} width={38} />
        <Tooltip {...tooltipStyle} />
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function BarsHorizontal({
  data,
  dataKey,
  nameKey = "name",
  colorKey,
}: {
  data: Record<string, string | number>[];
  dataKey: string;
  nameKey?: string;
  colorKey?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" {...axisProps} />
        <YAxis type="category" dataKey={nameKey} {...axisProps} width={110} />
        <Tooltip {...tooltipStyle} />
        <Bar dataKey={dataKey} radius={[0, 4, 4, 0]} barSize={14}>
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={colorKey ? String(entry[colorKey]) : "var(--accent)"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Donut({
  data,
}: {
  data: { name: string; value: number; color: string }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2} strokeWidth={0}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
        </Pie>
        <Tooltip {...tooltipStyle} />
      </PieChart>
    </ResponsiveContainer>
  );
}
