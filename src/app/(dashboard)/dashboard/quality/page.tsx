"use client";
import { DashboardAnalytics } from "@/components/workspace/dashboard-analytics";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ArrowRight, AlertTriangle } from "lucide-react";
import { formatPassRate } from "@/lib/format";
import type { DashboardData } from "@/lib/types";
import { PageHeader } from "@/components/workspace/page-ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Alert,
  AlertTitle,
  AlertDescription,
  AlertAction,
} from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
function QualityDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [failedKeys, setFailedKeys] = useState<string[]>([]);
  const [dateLabel, setDateLabel] = useState("");
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setDateLabel(
          new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Jakarta",
            day: "numeric",
            month: "long",
            year: "numeric",
          }).format(new Date()),
        ),
      0,
    );
    return () => clearTimeout(timer);
  }, []);
  const fetchData = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard/summary", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Summary unavailable");
      setData(await response.json());
      setFailedKeys([]);
      setLoadError(false);
    } catch {
      // Failed aggregate reads render unavailable KPIs rather than fake zeros.
      setFailedKeys([
        "total_produk",
        "total_lot",
        "lot_pass",
        "lot_fail",
        "total_coa",
        "recent_inspeksi",
      ]);
      setLoadError(true);
      setData({
        total_produk: 0,
        total_lot: 0,
        lot_pass: 0,
        lot_fail: 0,
        total_coa: 0,
        recent_inspeksi: [],
      });
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchData();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchData]);

  if (!data)
    return (
      <div className="page-stack" role="status" aria-label="Loading dashboard">
        <div className="space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-12 w-72 max-w-full" />
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="overview-summary">
          <div className="space-y-5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-28 w-72 max-w-full" />
            <Skeleton className="h-3 w-full" />
          </div>
          <div className="space-y-6">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  const resultFailed =
    failedKeys.includes("lot_pass") || failedKeys.includes("lot_fail");
  const total = data.lot_pass + data.lot_fail;
  const passRate = total ? (data.lot_pass / total) * 100 : 0;
  const metrics = [
    {
      key: "total_produk",
      label: "Products",
      value: data.total_produk,
      href: "/dashboard/master-data/products",
    },
    {
      key: "total_lot",
      label: "Lots inspected",
      value: data.total_lot,
      href: "/dashboard/quality/inspections",
    },
    {
      key: "total_coa",
      label: "COAs issued",
      value: data.total_coa,
      href: "/dashboard/quality/certificates",
    },
  ];
  return (
    <div className="page-stack overview-page">
      <PageHeader
        eyebrow="Dashboard"
        title="Quality overview"
        description={dateLabel || "INBIONUSA quality control"}
      />
      {loadError && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Some data is unavailable</AlertTitle>
          <AlertDescription>
            Values marked — could not be loaded.
          </AlertDescription>
          <AlertAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchData()}
            >
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}
      <section className="overview-summary" aria-label="Test summary">
        <div className="quality-summary">
          <p className="summary-label">Pass rate</p>
          <div className="summary-number">
            {resultFailed || !total ? (
              <span>—</span>
            ) : (
              <>
                <span>{formatPassRate(data.lot_pass, total)}</span>
                <span className="summary-percent">%</span>
              </>
            )}
          </div>
          <p className="summary-caption">
            {resultFailed
              ? "Could not load test results."
              : total
                ? `${data.lot_pass.toLocaleString("en-GB")} of ${total.toLocaleString("en-GB")} lots meet specifications.`
                : "A summary will appear after the first inspection."}
          </p>
          <div
            className="quality-bar"
            role="img"
            aria-label={
              resultFailed
                ? "Test results unavailable"
                : `${data.lot_pass} lots passed and ${data.lot_fail} lots failed`
            }
          >
            <span
              style={{ width: resultFailed || !total ? "0%" : `${passRate}%` }}
            />
            <span
              style={{
                width: resultFailed || !total ? "0%" : `${100 - passRate}%`,
              }}
            />
          </div>
          <div className="quality-legend">
            <span>
              <i />
              PASS{" "}
              <strong>
                {resultFailed ? "—" : data.lot_pass.toLocaleString("en-GB")}
              </strong>
            </span>
            <span>
              <i />
              FAIL{" "}
              <strong>
                {resultFailed ? "—" : data.lot_fail.toLocaleString("en-GB")}
              </strong>
            </span>
            <Link href="/dashboard/quality/inspections">
              View inspections
              <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        </div>
        <div className="overview-totals">
          {metrics.map(({ key, label, value, href }) => (
            <Link href={href} key={key}>
              <span>{label}</span>
              <strong>
                {failedKeys.includes(key) ? "—" : value.toLocaleString("en-GB")}
              </strong>
              <ArrowUpRight className="size-4" />
            </Link>
          ))}
        </div>
      </section>
      <DashboardAnalytics />
      <div className="overview-records quality-recent-only">
        <section className="recent-section">
          <div className="section-heading">
            <div>
              <h2>Recent inspections</h2>
              <p>The eight most recent inspections.</p>
            </div>
            <Link href="/dashboard/quality/inspections">
              View all
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <Table className="dashboard-recent-table">
            <TableHeader>
              <TableRow>
                <TableHead>Lot number</TableHead>
                <TableHead>Products</TableHead>
                <TableHead>Test date</TableHead>
                <TableHead className="text-right">Results</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recent_inspeksi.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <span
                      className="block truncate text-xs font-medium"
                      title={row.no_lot}
                    >
                      {row.no_lot}
                    </span>
                  </TableCell>
                  <TableCell>
                    <p
                      className="truncate text-xs font-medium"
                      title={row.master_produk?.nama_produk}
                    >
                      {row.master_produk?.nama_produk || "—"}
                    </p>
                    <p
                      className="mt-1 truncate text-[11px] text-muted"
                      title={row.master_produk?.kode_produk}
                    >
                      {row.master_produk?.kode_produk}
                    </p>
                  </TableCell>
                  <TableCell className="text-xs text-muted">
                    {row.tgl_uji}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant={
                        row.status === "PASS" ? "default" : "destructive"
                      }
                    >
                      {row.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(failedKeys.includes("recent_inspeksi") ||
                !data.recent_inspeksi.length) && (
                <TableRow>
                  <TableCell colSpan={4} className="!h-52 text-center">
                    <p className="text-sm font-medium">
                      {failedKeys.includes("recent_inspeksi")
                        ? "Inspections unavailable"
                        : "No inspections yet"}
                    </p>
                    <p className="mt-2 text-xs text-muted">
                      Add a product and specifications to start testing.
                    </p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </section>
      </div>
      <footer className="overview-footnote">
        <span>INBIONUSA</span>
        <span>Quality Control System</span>
      </footer>
    </div>
  );
}

export default function DashboardPage() {
  return <QualityDashboardPage />;
}
