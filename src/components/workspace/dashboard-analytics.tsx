"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Activity,
  ShieldCheck,
  FileCheck2,
  FolderClock,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { formatPassRate } from "@/lib/format";
import type {
  DashboardAnalytics as AnalyticsData,
  AnalyticsPeriod,
} from "@/lib/dashboard-analytics";
const views = [
  { id: "activity", label: "Activity", icon: Activity },
  { id: "quality", label: "Quality", icon: ShieldCheck },
  { id: "issuance", label: "COAs", icon: FileCheck2 },
  { id: "documents", label: "Documents", icon: FolderClock },
] as const;
type View = (typeof views)[number]["id"];
const number = (n: number) => n.toLocaleString("en-GB");
const day = (s: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(s + "T00:00:00Z"));
export function DashboardAnalytics() {
  const [view, setView] = useState<View>("activity"),
    [period, setPeriod] = useState<AnalyticsPeriod>(30),
    [retry, setRetry] = useState(0);
  const [response, setResponse] = useState<{
    period: AnalyticsPeriod;
    data?: AnalyticsData;
    error?: boolean;
  } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const r = await fetch(`/api/dashboard/analytics?period=${period}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!r.ok) throw Error();
        const data: AnalyticsData = await r.json();
        if (!controller.signal.aborted) setResponse({ period, data });
      } catch {
        if (!controller.signal.aborted) setResponse({ period, error: true });
      }
    })();
    return () => controller.abort();
  }, [period, retry]);
  const current = response?.period === period ? response : null,
    data = current?.data;
  const totals = data?.buckets.reduce(
    (t, b) => ({
      passed: t.passed + b.passed,
      failed: t.failed + b.failed,
      issued: t.issued + b.issued,
    }),
    { passed: 0, failed: 0, issued: 0 },
  );
  const inspected = totals ? totals.passed + totals.failed : 0;
  const active = data && selected !== null ? data.buckets[selected] : null;
  const max = Math.max(
    1,
    ...(data?.buckets.map((b) =>
      view === "issuance" ? b.issued : b.passed + b.failed,
    ) ?? []),
  );
  const line = data?.buckets
    .map((b, i) => `${20 + i * 112},${140 - (b.issued / max) * 120}`)
    .join(" ");
  const caption = active
    ? `${day(active.from)} – ${day(active.to)}`
    : data
      ? `${day(data.from)} – ${day(data.to)}`
      : "";
  const metric =
    view === "activity"
      ? number(active ? active.passed + active.failed : inspected)
      : view === "issuance"
        ? number(active?.issued ?? totals?.issued ?? 0)
        : view === "quality"
          ? inspected
            ? `${formatPassRate(totals!.passed, inspected)}%`
            : "—"
          : number(data?.documents.valid ?? 0);
  const metricLabel =
    view === "activity"
      ? "inspections completed"
      : view === "issuance"
        ? "certificates released"
        : view === "quality"
          ? "of inspected lots passed"
          : "valid documents";
  return (
    <section className="analytics-studio" aria-label="Quality analytics">
      <div className="analytics-heading">
        <div>
          <p className="micro-label">Explore your operation</p>
          <h2>Analytics</h2>
        </div>
        <label className="analytics-period">
          <span className="sr-only">Analytics period</span>
          <select
            aria-label="Analytics period"
            value={period}
            disabled={view === "documents"}
            onChange={(e) => {
              setPeriod(Number(e.target.value) as AnalyticsPeriod);
              setSelected(null);
            }}
          >
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </label>
      </div>
      <Tabs
        value={view}
        onValueChange={(value) => {
          setView(value as View);
          setSelected(null);
        }}
      >
        <TabsList className="analytics-tabs" aria-label="Analytics views">
          {views.map(({ id, label, icon: Icon }) => (
            <TabsTrigger value={id} key={id}>
              <Icon className="size-3.5" />
              <span>{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {views.map(({ id }) => (
          <TabsContent value={id} key={id}>
            {!current ? (
              <div className="analytics-placeholder" role="status">
                Loading analytics…
              </div>
            ) : current.error ? (
              <div className="analytics-placeholder" role="alert">
                <p>Could not load analytics.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setResponse(null);
                    setRetry((v) => v + 1);
                  }}
                >
                  Retry analytics
                </Button>
              </div>
            ) : (
              data &&
              totals && (
                <>
                  <div className="analytics-stage surface-enter" key={view}>
                    <div className="analytics-readout">
                      <p className="analytics-context">
                        {view === "documents"
                          ? "Current document status"
                          : caption}
                      </p>
                      <strong className="analytics-number">{metric}</strong>
                      <p>{metricLabel}</p>
                      <div className="analytics-insight">
                        {view === "activity" ? (
                          <>
                            <span className="analytics-dot" />
                            {number(active?.passed ?? totals.passed)} passed ·{" "}
                            {number(active?.failed ?? totals.failed)} failed
                          </>
                        ) : view === "quality" ? (
                          inspected ? (
                            `${number(totals.failed)} of ${number(inspected)} lots need review.`
                          ) : (
                            "No inspections in this period."
                          )
                        ) : view === "issuance" ? (
                          "Grouped by certificate release date."
                        ) : (
                          `${number(data.documents.expiring)} expire in the next 30 days.`
                        )}
                      </div>
                      <Link
                        href={
                          view === "documents"
                            ? "/dashboard/arsip"
                            : view === "issuance"
                              ? "/dashboard/coa"
                              : "/dashboard/inspeksi"
                        }
                      >
                        Open{" "}
                        {view === "documents"
                          ? "documents"
                          : view === "issuance"
                            ? "COAs"
                            : "inspections"}
                        <ArrowUpRight className="size-3.5" />
                      </Link>
                    </div>
                    <div className="analytics-visual">
                      {view === "activity" && (
                        <div
                          className="analytics-bar-chart"
                          role="group"
                          aria-label="Inspections by test date"
                        >
                          {data.buckets.map((b, i) => (
                            <button
                              type="button"
                              key={b.from}
                              aria-pressed={selected === i}
                              aria-label={`${day(b.from)} to ${day(b.to)}: ${b.passed} passed, ${b.failed} failed`}
                              onClick={() =>
                                setSelected(selected === i ? null : i)
                              }
                              className="analytics-bar-column"
                            >
                              <span className="analytics-bar-track">
                                <span
                                  className="analytics-bar-stack"
                                  style={{
                                    height: `${((b.passed + b.failed) / max) * 100}%`,
                                  }}
                                >
                                  <i
                                    className="analytics-failed"
                                    style={{ flex: b.failed }}
                                  />
                                  <i
                                    className="analytics-passed"
                                    style={{ flex: b.passed }}
                                  />
                                </span>
                              </span>
                              <span>{day(b.from)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {view === "quality" && (
                        <div className="analytics-donut-wrap">
                          <svg
                            className="analytics-donut"
                            viewBox="0 0 160 160"
                            role="img"
                            aria-label={`${number(totals.passed)} passed, ${number(totals.failed)} failed`}
                          >
                            <circle
                              cx="80"
                              cy="80"
                              r="61"
                              className="analytics-ring-base"
                            />
                            <circle
                              cx="80"
                              cy="80"
                              r="61"
                              pathLength="100"
                              className={
                                inspected
                                  ? "analytics-ring-failed"
                                  : "analytics-ring-base"
                              }
                            />
                            <circle
                              cx="80"
                              cy="80"
                              r="61"
                              pathLength="100"
                              className="analytics-ring-passed"
                              strokeDasharray={`${inspected ? (totals.passed / inspected) * 100 : 0} 100`}
                              transform="rotate(-90 80 80)"
                            />
                            <text
                              x="80"
                              y="77"
                              textAnchor="middle"
                              className="analytics-ring-number"
                            >
                              {number(inspected)}
                            </text>
                            <text
                              x="80"
                              y="97"
                              textAnchor="middle"
                              className="analytics-ring-label"
                            >
                              lots tested
                            </text>
                          </svg>
                          <div className="analytics-donut-legend">
                            <span>
                              <i className="analytics-passed" />
                              PASS <strong>{number(totals.passed)}</strong>
                            </span>
                            <span>
                              <i className="analytics-failed" />
                              FAIL <strong>{number(totals.failed)}</strong>
                            </span>
                          </div>
                        </div>
                      )}
                      {view === "issuance" && (
                        <div className="analytics-line-chart">
                          <svg
                            viewBox="0 0 600 160"
                            role="img"
                            aria-label={`${number(totals.issued)} certificates released across six intervals`}
                            preserveAspectRatio="none"
                          >
                            <path
                              d="M20 20H580 M20 80H580 M20 140H580"
                              className="analytics-grid-line"
                            />
                            <polygon
                              points={`20,150 ${line} 580,150`}
                              className="analytics-line-area"
                            />
                            <polyline
                              points={line}
                              className="analytics-line"
                            />
                            {data.buckets.map((b, i) => (
                              <circle
                                key={b.from}
                                cx={20 + i * 112}
                                cy={140 - (b.issued / max) * 120}
                                r={selected === i ? 6 : 4}
                                className="analytics-line-point"
                              >
                                <title>
                                  {day(b.from)} – {day(b.to)}: {b.issued} COAs
                                </title>
                              </circle>
                            ))}
                          </svg>
                          <div className="analytics-line-labels">
                            {data.buckets.map((b, i) => (
                              <button
                                type="button"
                                key={b.from}
                                aria-pressed={selected === i}
                                aria-label={`${day(b.from)} to ${day(b.to)}: ${b.issued} certificates`}
                                onClick={() =>
                                  setSelected(selected === i ? null : i)
                                }
                              >
                                {day(b.from)}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {view === "documents" && (
                        <div className="analytics-document-bars">
                          {[
                            {
                              label: "Valid beyond 30 days",
                              count: Math.max(
                                0,
                                data.documents.valid - data.documents.expiring,
                              ),
                              style: "analytics-passed",
                            },
                            {
                              label: "Expiring within 30 days",
                              count: data.documents.expiring,
                              style: "analytics-expiring",
                            },
                            {
                              label: "Expired",
                              count: data.documents.expired,
                              style: "analytics-failed",
                            },
                          ].map((d) => (
                            <div key={d.label}>
                              <div>
                                <span>{d.label}</span>
                                <strong>{number(d.count)}</strong>
                              </div>
                              <div className="analytics-document-track">
                                <i
                                  className={d.style}
                                  style={{
                                    width: `${(d.count / Math.max(1, data.documents.valid + data.documents.expired)) * 100}%`,
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="analytics-footer">
                    <span>
                      {view === "documents"
                        ? "Expiry dates checked today"
                        : view === "quality"
                          ? "Based on test dates · PASS and FAIL lots"
                          : "Select an interval to inspect it"}
                    </span>
                    <span>
                      {views.findIndex((v) => v.id === view) + 1} /{" "}
                      {views.length}
                    </span>
                  </div>
                  <details className="analytics-data">
                    <summary>View chart data</summary>
                    <div>
                      <table>
                        <caption>
                          {view === "documents"
                            ? "Current document counts"
                            : `Analytics: ${day(data.from)} – ${day(data.to)}`}
                        </caption>
                        <thead>
                          <tr>
                            {(view === "documents"
                              ? ["Status", "Documents"]
                              : ["Interval", "Passed", "Failed", "COAs"]
                            ).map((h) => (
                              <th key={h}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {view === "documents"
                            ? [
                                [
                                  "Valid (includes expiring)",
                                  data.documents.valid,
                                ],
                                [
                                  "Expiring within 30 days",
                                  data.documents.expiring,
                                ],
                                ["Expired", data.documents.expired],
                              ].map(([label, count]) => (
                                <tr key={label}>
                                  <th scope="row">{label}</th>
                                  <td>{count}</td>
                                </tr>
                              ))
                            : data.buckets.map((b) => (
                                <tr key={b.from}>
                                  <th scope="row">
                                    {day(b.from)} – {day(b.to)}
                                  </th>
                                  <td>{number(b.passed)}</td>
                                  <td>{number(b.failed)}</td>
                                  <td>{number(b.issued)}</td>
                                </tr>
                              ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              )
            )}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
