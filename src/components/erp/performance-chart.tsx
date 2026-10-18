"use client";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
export default function PerformanceChart({
  series,
}: {
  series: { date: string; count: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart
        data={series}
        margin={{ top: 15, left: -20, right: 12, bottom: 0 }}
      >
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="date"
          tickFormatter={(v) => String(v).slice(5)}
          minTickGap={40}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          labelFormatter={(v) => String(v)}
          formatter={(v) => [v, "Records"]}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke="var(--color-primary)"
          fill="var(--color-primary-soft)"
          strokeWidth={2}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
