"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowUpRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { decimal, type ModuleKey } from "@/lib/erp/schema";
import { useERP } from "./context";
type Data = {
  metrics: { label: string; value: number }[];
  attention: { label: string; value: number; href: string }[];
  series: { date: string; count: number }[];
  chart_label: string;
  amounts: { currency: string; amount: string }[];
  amount_label: string;
};
export function ModuleInsights({
  module,
}: {
  module: Exclude<ModuleKey, "quality">;
}) {
  const erp = useERP(),
    [open, setOpen] = useState(false),
    [days, setDays] = useState("30"),
    [retry, setRetry] = useState(0),
    [result, setResult] = useState<{
      key: string;
      data?: Data;
      error?: string;
    } | null>(null);
  const enabled = erp.can(module),
    key = module + ":" + days + ":" + retry;
  useEffect(() => {
    if (!enabled || !open) return;
    const abort = new AbortController();
    void fetch(
      "/api/erp/insights?" + new URLSearchParams({ state: module, q: days }),
      { signal: abort.signal, cache: "no-store" },
    )
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw Error(data.message || "Could not load insights.");
        if (!abort.signal.aborted) setResult({ key, data });
      })
      .catch((e) => {
        if (!abort.signal.aborted) setResult({ key, error: e.message });
      });
    return () => abort.abort();
  }, [enabled, open, module, days, retry, key]);
  if (!enabled) return null;
  const current = result?.key === key ? result : null,
    data = current?.data,
    max = Math.max(1, ...(data?.series.map((d) => d.count) || []));
  return (
    <section className="module-insights" aria-label={`${module} insights`}>
      <button
        type="button"
        className="module-insights-trigger"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Activity aria-hidden="true" />
        <span>
          <strong>Operational insights</strong>
          <small>Trends, current workload and items to review</small>
        </span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div className="module-insights-body">
          <div className="module-insights-period">
            <span>Daily activity</span>
            <label>
              Period
              <select
                aria-label="Insights period"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              >
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
            </label>
          </div>
          {current?.error ? (
            <div role="alert">
              <p>{current.error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRetry((v) => v + 1)}
              >
                Retry insights
              </Button>
            </div>
          ) : !data ? (
            <p role="status">Loading insights…</p>
          ) : (
            <>
              <div className="module-insights-metrics">
                {data.metrics.map((m) => (
                  <article key={m.label}>
                    <span>{m.label}</span>
                    <strong>{m.value.toLocaleString("en-GB")}</strong>
                  </article>
                ))}
              </div>
              <details className="module-insights-trend">
                <summary>
                  {data.chart_label}
                  <span>{days} days</span>
                </summary>
                <div
                  className="insights-bars"
                  role="img"
                  aria-label={`${data.chart_label}, daily counts over ${days} days`}
                >
                  {data.series.map((d) => (
                    <span
                      key={d.date}
                      style={{
                        height: Math.max(2, (d.count / max) * 70) + "px",
                      }}
                      title={`${d.date}: ${d.count}`}
                    />
                  ))}
                </div>
                <div
                  className="insights-table"
                  tabIndex={0}
                  role="region"
                  aria-label="Daily activity data"
                >
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Records</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.series.map((d) => (
                        <tr key={d.date}>
                          <td>{d.date}</td>
                          <td>{d.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              {data.amounts.length > 0 && (
                <div className="insights-amounts">
                  <p>{data.amount_label}</p>
                  {data.amounts.map((a) => (
                    <strong key={a.currency}>
                      {a.currency} {decimal(a.amount)}
                    </strong>
                  ))}
                  <small>Current open records, grouped by currency.</small>
                </div>
              )}
              <div className="insights-attention">
                {data.attention.map((a) => (
                  <Link key={a.label} href={a.href}>
                    <span>{a.label}</span>
                    <strong>{a.value.toLocaleString("en-GB")}</strong>
                    <ArrowUpRight aria-hidden="true" />
                  </Link>
                ))}
              </div>
              <p className="module-insights-note">
                Activity trends and counts use the selected period. Workload,
                alerts and open values show current status.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
