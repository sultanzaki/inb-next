"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  FileCheck2,
  ArrowUpRight,
  ArrowRight,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatPassRate } from "@/lib/format";
import { businessDate } from "@/lib/domain/validation";
import type { DashboardData, HasilUjiRow } from "@/lib/types";
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
function localTodayStr() {
  return businessDate();
}
export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
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
    const sb = createClient();
    setLoading(true);
    const today = localTodayStr();

    try {
      const [
        { count: total_produk, error: e_produk },
        { count: total_lot, error: e_lot },
        { count: lot_pass, error: e_pass },
        { count: lot_fail, error: e_fail },
        { count: total_coa, error: e_coa },
        { count: total_dok, error: e_dok },
        { count: dok_expired, error: e_expired },
        { data: hasilRaw, error: e_inspeksi },
      ] = await Promise.all([
        sb.from("master_produk").select("*", { count: "exact", head: true }),
        sb.from("hasil_uji").select("*", { count: "exact", head: true }),
        sb
          .from("hasil_uji")
          .select("*", { count: "exact", head: true })
          .eq("status", "PASS"),
        sb
          .from("hasil_uji")
          .select("*", { count: "exact", head: true })
          .eq("status", "FAIL"),
        sb.from("coa").select("*", { count: "exact", head: true }),
        sb
          .from("dokumen_arsip")
          .select("*", { count: "exact", head: true })
          .gte("masa_kadaluarsa", today),
        sb
          .from("dokumen_arsip")
          .select("*", { count: "exact", head: true })
          .lt("masa_kadaluarsa", today),
        sb
          .from("hasil_uji")
          .select("*, master_produk!inner(kode_produk, nama_produk)")
          .order("created_at", { ascending: false })
          .limit(8),
      ]);

      // Check .error on EVERY query: a failed count must never be rendered
      // as a real 0 / "Belum ada data inspeksi."
      const failures: string[] = [];
      if (e_produk) failures.push("total_produk");
      if (e_lot) failures.push("total_lot");
      if (e_pass) failures.push("lot_pass");
      if (e_fail) failures.push("lot_fail");
      if (e_coa) failures.push("total_coa");
      if (e_dok) failures.push("dok_berlaku");
      if (e_expired) failures.push("dok_expired");
      if (e_inspeksi) failures.push("recent_inspeksi");

      setFailedKeys(failures);
      setLoadError(failures.length > 0);

      setData({
        total_produk: total_produk ?? 0,
        total_lot: total_lot ?? 0,
        lot_pass: lot_pass ?? 0,
        lot_fail: lot_fail ?? 0,
        total_coa: total_coa ?? 0,
        dok_berlaku: total_dok ?? 0,
        dok_expired: dok_expired ?? 0,
        recent_inspeksi: (hasilRaw as HasilUjiRow[]) ?? [],
      });
    } catch {
      // Promise.all itself rejected (network throw): treat every query as
      // failed so every KPI renders "—" instead of fake zeros.
      setFailedKeys([
        "total_produk",
        "total_lot",
        "lot_pass",
        "lot_fail",
        "total_coa",
        "dok_berlaku",
        "dok_expired",
        "recent_inspeksi",
      ]);
      setLoadError(true);
      setData({
        total_produk: 0,
        total_lot: 0,
        lot_pass: 0,
        lot_fail: 0,
        total_coa: 0,
        dok_berlaku: 0,
        dok_expired: 0,
        recent_inspeksi: [],
      });
    } finally {
      setLoading(false);
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
      href: "/dashboard/produk",
    },
    {
      key: "total_lot",
      label: "Lots inspected",
      value: data.total_lot,
      href: "/dashboard/inspeksi",
    },
    {
      key: "total_coa",
      label: "COAs issued",
      value: data.total_coa,
      href: "/dashboard/coa",
    },
  ];
  return (
    <div className="page-stack overview-page">
      <PageHeader
        eyebrow="Dashboard"
        title="Quality overview"
        description={dateLabel || "INBIONUSA quality control"}
      >
        <Button
          variant="outline"
          loading={loading}
          onClick={() => void fetchData()}
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </PageHeader>
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
            <Link href="/dashboard/inspeksi">
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
      <div className="overview-records">
        <section className="recent-section">
          <div className="section-heading">
            <div>
              <h2>Recent inspections</h2>
              <p>The eight most recent inspections.</p>
            </div>
            <Link href="/dashboard/inspeksi">
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
        <aside className="document-summary">
          <div className="section-heading">
            <h2>Documents</h2>
            <Link href="/dashboard/arsip" aria-label="Open documents">
              <ArrowUpRight className="size-4" />
            </Link>
          </div>
          <div className="document-count">
            <strong>
              {failedKeys.includes("dok_berlaku")
                ? "—"
                : data.dok_berlaku.toLocaleString("en-GB")}
            </strong>
            <span>valid documents</span>
          </div>
          <div className="document-review" data-warning={data.dok_expired > 0}>
            <span className="document-review-count">
              {failedKeys.includes("dok_expired")
                ? "—"
                : data.dok_expired.toLocaleString("en-GB")}
            </span>
            <div>
              <p>Expired</p>
              <span>
                {failedKeys.includes("dok_expired")
                  ? "Could not load documents."
                  : data.dok_expired
                    ? "Review and update these documents."
                    : "No expired documents."}
              </span>
            </div>
          </div>
          <Link className="document-link" href="/dashboard/arsip">
            Manage documents
            <ArrowRight className="size-4" />
          </Link>
          <div className="document-footnote">
            <FileCheck2 className="size-5" />
            <p>Certificates use the results recorded at issuance.</p>
          </div>
        </aside>
      </div>
      <footer className="overview-footnote">
        <span>INBIONUSA</span>
        <span>Quality Control System</span>
      </footer>
    </div>
  );
}
