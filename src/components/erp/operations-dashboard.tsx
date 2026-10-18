"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useERP } from "./context";
import { WorkInbox } from "./release-workflows";
import dynamic from "next/dynamic";
const PerformanceChart = dynamic(() => import("./performance-chart"), {
  loading: () => (
    <div
      className="h-[220px] skeleton-shimmer"
      aria-label="Loading chart"
      role="status"
    />
  ),
});
import { Button } from "@/components/ui/button";
import { ArrowUpRight } from "lucide-react";
type Snapshot = {
  areas: string[];
  metrics: { label: string; value: number }[];
  series: { date: string; count: number }[];
  activity: { action: string; created_at: string }[];
  chart_label: string;
  days: number;
};
export function OperationsDashboard() {
  const erp = useERP(),
    [area, setArea] = useState("overview"),
    [days, setDays] = useState("30"),
    [value, setValue] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => {
      const a = localStorage.getItem("inb-performance-area"),
        d = localStorage.getItem("inb-performance-days");
      if (
        a &&
        [
          "overview",
          ...(erp.data?.modules
            .filter((m) => m.state !== "disabled" && m.read)
            .map((m) => m.key) || []),
        ].includes(a)
      )
        setArea(a);
      if (d && ["7", "30", "90"].includes(d)) setDays(d);
    }, 0);
    return () => clearTimeout(t);
  }, [erp.data]);
  useEffect(() => {
    const abort = new AbortController();
    void fetch(
      "/api/erp/overview?" + new URLSearchParams({ state: area, q: days }),
      { signal: abort.signal, cache: "no-store" },
    )
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.message || "Could not load performance.");
        if (!abort.signal.aborted) {
          setValue(d);
          setError("");
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [area, days, retry]);
  const areas = [
    "overview",
    ...(erp.data?.modules.filter((m) => erp.can(m.key)).map((m) => m.key) ||
      []),
  ];
  function select(a: string) {
    if (a === area) return;
    setValue(null);
    setArea(a);
    localStorage.setItem("inb-performance-area", a);
  }
  return (
    <div className="page-stack release-dashboard">
      <header className="release-home-header">
        <div>
          <p className="micro-label">INBIONUSA OPERATIONS</p>
          <h1>Your workspace</h1>
          <p>See what needs attention. Keep work moving.</p>
        </div>
        <Link href="/dashboard/workspaces">
          Explore workspace <ArrowUpRight className="inline size-4" />
        </Link>
      </header>
      <WorkInbox compact />
      <section className="performance-panel">
        <div className="release-section-heading">
          <div>
            <p className="micro-label">PERFORMANCE</p>
            <h2>Performance</h2>
          </div>
          <select
            aria-label="Performance period"
            value={days}
            onChange={(e) => {
              if (e.target.value === days) return;
              setValue(null);
              setDays(e.target.value);
              localStorage.setItem("inb-performance-days", e.target.value);
            }}
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
        <nav className="performance-areas" aria-label="Performance context">
          {areas.map((a) => (
            <button
              key={a}
              aria-current={area === a ? "page" : undefined}
              onClick={() => select(a)}
            >
              {a}
            </button>
          ))}
        </nav>
        <select
          className="performance-mobile-select"
          aria-label="Performance context"
          value={area}
          onChange={(e) => select(e.target.value)}
        >
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <Button variant="outline" onClick={() => setRetry((r) => r + 1)}>
              Retry
            </Button>
          </div>
        ) : !value ? (
          <p role="status" className="performance-loading">
            Loading performance…
          </p>
        ) : (
          <>
            <div className="performance-layout">
              <div className="performance-chart">
                <h3>{value.chart_label}</h3>
                <div
                  role="img"
                  aria-label={
                    value.chart_label + " over the last " + value.days + " days"
                  }
                >
                  <PerformanceChart series={value.series} />
                </div>
                <details className="chart-data">
                  <summary>View chart data</summary>
                  <div>
                    {value.series.map((d) => (
                      <p key={d.date}>
                        <time>{d.date}</time>
                        <span>{d.count}</span>
                      </p>
                    ))}
                  </div>
                </details>
              </div>
              <div className="performance-metrics">
                {value.metrics.map((m) => (
                  <article key={m.label}>
                    <span>{m.label}</span>
                    <strong>{m.value.toLocaleString("en-GB")}</strong>
                  </article>
                ))}
              </div>
            </div>
            <p className="performance-note">
              Daily record counts. Open, draft and held totals show current
              status.
            </p>
            {area !== "overview" && (
              <Link
                className="performance-detail-link"
                href={
                  area === "quality"
                    ? "/dashboard/quality"
                    : "/dashboard/" + area
                }
              >
                Open {area} workspace <ArrowUpRight className="inline size-4" />
              </Link>
            )}
          </>
        )}
      </section>
      <section className="recent-activity">
        <div className="release-section-heading">
          <div>
            <p className="micro-label">RECENT ACTIVITY</p>
            <h2>Your latest actions</h2>
          </div>
        </div>
        {value?.activity.length ? (
          value.activity.map((a, i) => (
            <article key={a.created_at + i}>
              <span>{a.action}</span>
              <time>
                {new Date(a.created_at).toLocaleString("en-GB", {
                  timeZone: "Asia/Jakarta",
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
            </article>
          ))
        ) : (
          <p>Your recorded activity will appear here.</p>
        )}
      </section>
    </div>
  );
}
