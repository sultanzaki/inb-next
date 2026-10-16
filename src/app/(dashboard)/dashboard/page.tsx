"use client";

import { useEffect, useState, useCallback, type ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { HasilUjiRow, DashboardData } from "@/lib/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowRight } from "lucide-react";

// Local calendar date as YYYY-MM-DD. Built from the local getters with
// padStart — NOT toISOString(), which yields the UTC date and disagrees with
// arsip's local-date partition during 00:00–06:59 WIB (UTC+7).
function localTodayStr(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

type StatKey =
  | "total_produk"
  | "total_lot"
  | "lot_pass"
  | "lot_fail"
  | "total_coa"
  | "dok_berlaku"
  | "dok_expired";

// One instrument row: each cell keeps its semantic accent for the 3px bar.
const statCells: { key: StatKey; label: string; accent: string }[] = [
  { key: "total_produk", label: "Total Produk", accent: "var(--color-success)" },
  { key: "total_lot", label: "Lot Diuji", accent: "var(--color-info)" },
  { key: "lot_pass", label: "Lot PASS", accent: "var(--color-success)" },
  { key: "lot_fail", label: "Lot FAIL", accent: "var(--color-danger)" },
  { key: "total_coa", label: "COA Terbit", accent: "var(--color-violet)" },
  { key: "dok_berlaku", label: "Dokumen", accent: "var(--color-warning)" },
  { key: "dok_expired", label: "Dok. Kadaluarsa", accent: "var(--color-danger)" },
];

type DotTone = "success" | "danger" | "warning";

const dotTones: Record<DotTone, { chip: string; dot: string }> = {
  success: { chip: "bg-success-bg text-success-dark", dot: "bg-success" },
  danger: { chip: "bg-danger-bg text-danger-dark", dot: "bg-danger" },
  warning: { chip: "bg-warning-bg text-warning-dark", dot: "bg-warning" },
};

// Status chip: 4px radius, 5px semantic dot + text, tinted bg, no border.
function DotChip({
  tone,
  children,
}: {
  tone: DotTone;
  children: ReactNode;
}) {
  const t = dotTones[tone];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-[4px] px-2 py-1 text-[11.5px] font-medium leading-tight ${t.chip}`}
    >
      <span className={`size-[5px] rounded-full ${t.dot}`} aria-hidden="true" />
      {children}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <DotChip tone={status === "PASS" ? "success" : "danger"}>{status}</DotChip>
  );
}

function DonutChart({
  passRate,
  failRate,
  passCount,
  failCount,
  failed,
}: {
  passRate: number;
  failRate: number;
  passCount: number;
  failCount: number;
  failed: boolean;
}) {
  const circumference = 2 * Math.PI * 42;

  // PASS: full-length dash trimmed to passRate%, starting at 12 o'clock
  // (the svg has -rotate-90 and a <circle> path starts at 3 o'clock).
  // FAIL: dash segment of failRate% length, shifted forward by passRate%
  // via a negative dashoffset, so it starts exactly where PASS ends.
  // Sanity check: pass 90 / fail 10 => green covers 0-90% of the ring,
  // red covers 90-100% (not 90% of the ring like the old math produced).
  const passOffset = circumference - (passRate / 100) * circumference;
  const failOffset = -(passRate / 100) * circumference;

  return (
    <div className="flex w-full flex-col items-center">
      <div className="relative h-40 w-40">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="var(--color-border)"
            strokeWidth="10"
          />
          {/* Arcs render only when BOTH lot_pass and lot_fail succeeded:
              on a partial failure the surviving side would otherwise fill
              the whole ring at a fake 100% (leave the neutral ring only). */}
          {!failed && passRate > 0 && (
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="var(--color-success)"
              strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={passOffset}
              strokeLinecap="round"
              className="transition-all duration-700 ease-out"
            />
          )}
          {!failed && failRate > 0 && (
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="var(--color-danger)"
              strokeWidth="10"
              strokeDasharray={`${(failRate / 100) * circumference} ${circumference}`}
              strokeDashoffset={failOffset}
              strokeLinecap="round"
              className="transition-all duration-700 ease-out"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[26px] font-bold leading-none tracking-[-0.01em] tabular-nums">
            {failed ? "—" : `${passRate}%`}
          </span>
          <span className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            PASS
          </span>
        </div>
      </div>
      <div className="mt-4 w-full space-y-2">
        <div className="flex items-center justify-between">
          <DotChip tone="success">PASS</DotChip>
          <span className="font-data text-[13px]">
            {failed ? "—" : passCount}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <DotChip tone="danger">FAIL</DotChip>
          <span className="font-data text-[13px]">
            {failed ? "—" : failCount}
          </span>
        </div>
      </div>
    </div>
  );
}

// Shared header anatomy: micro-label + 24px title left, date/greeting right.
function PageHeaderSkeleton() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-6 w-40" />
      </div>
      <Skeleton className="h-11 w-44" />
    </div>
  );
}

function KpiStripSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="bg-surface p-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-7 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="flex h-11 items-center gap-4 bg-surface-alt px-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="ml-auto h-3 w-14" />
      </div>
      <div className="divide-y divide-border-soft">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex h-11 items-center gap-4 px-3">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="ml-auto h-3.5 w-20" />
            <Skeleton className="h-5 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}

function RightColumnSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-border bg-surface p-4">
        <Skeleton className="h-3 w-28" />
        <div className="mt-4 flex justify-center">
          <Skeleton className="size-40 rounded-full" />
        </div>
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-14" />
            <Skeleton className="h-3.5 w-8" />
          </div>
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-14" />
            <Skeleton className="h-3.5 w-8" />
          </div>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-surface p-4">
        <Skeleton className="h-3 w-20" />
        <div className="mt-4 grid grid-cols-2">
          <div className="pr-4">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="mt-2 h-7 w-12" />
          </div>
          <div className="border-l border-border-soft pl-4">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="mt-2 h-7 w-12" />
          </div>
        </div>
        <Skeleton className="mt-4 h-3.5 w-28" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [failedKeys, setFailedKeys] = useState<string[]>([]);
  const [greeting, setGreeting] = useState("");
  const [todayLabel, setTodayLabel] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
    const now = new Date();
    const h = now.getHours();
    if (h < 12) setGreeting("Selamat Pagi");
    else if (h < 15) setGreeting("Selamat Siang");
    else if (h < 18) setGreeting("Selamat Sore");
    else setGreeting("Selamat Malam");
    // Date label computed inside the effect: `new Date()` during render is an
    // unstable value and fails Cache Components prerender validation.
    setTodayLabel(
      new Intl.DateTimeFormat("id-ID", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(now)
    );
    }, 0);
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
    const timer = setTimeout(() => { void fetchData(); }, 0);
    return () => clearTimeout(timer);
  }, [fetchData]);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <PageHeaderSkeleton />
        <KpiStripSkeleton />
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[2fr_1fr]">
          <TableSkeleton />
          <RightColumnSkeleton />
        </div>
      </div>
    );
  }

  const total = data.lot_pass + data.lot_fail;
  const passRate = total > 0 ? Math.round((data.lot_pass / total) * 100) : 0;
  const failRate = total > 0 ? Math.round((data.lot_fail / total) * 100) : 0;
  const lotFailed =
    failedKeys.includes("lot_pass") || failedKeys.includes("lot_fail");

  const dokBerlaku = failedKeys.includes("dok_berlaku")
    ? "—"
    : data.dok_berlaku.toLocaleString();
  const dokExpired = failedKeys.includes("dok_expired")
    ? "—"
    : data.dok_expired.toLocaleString();

  return (
    <div className="space-y-6">
      {/* Page header: micro-label + title left, date/greeting right */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="micro-label">RINGKASAN</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Dashboard
          </h1>
        </div>
        <div className="text-right">
          {greeting ? (
            <>
              <p className="text-sm font-medium">{greeting}</p>
              <p className="mt-1 text-[13px] text-muted">{todayLabel}</p>
            </>
          ) : (
            <div
              className="ml-auto h-11 w-44 rounded-[4px] bg-chip-bg"
              aria-hidden="true"
            />
          )}
        </div>
      </div>

      {/* Error banner */}
      {loadError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Gagal memuat data dashboard</AlertTitle>
          <AlertDescription>
            Beberapa data tidak berhasil dimuat dari server. Angka bertanda
            &ldquo;&mdash;&rdquo; tidak tersedia.
          </AlertDescription>
          <AlertAction>
            <Button variant="outline" size="sm" onClick={() => fetchData()}>
              Coba Lagi
            </Button>
          </AlertAction>
        </Alert>
      )}

      {/* KPI instrument strip: one card, cells split by vertical hairlines */}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4 xl:grid-cols-7">
          {statCells.map((s) => {
            const value = data[s.key];
            const failed = failedKeys.includes(s.key);
            return (
              <div key={s.key} className="relative bg-surface p-4">
                <div
                  className="absolute inset-y-0 left-0 w-[3px]"
                  style={{ backgroundColor: s.accent }}
                  aria-hidden="true"
                />
                <p className="micro-label">{s.label}</p>
                <p className="mt-2 text-[28px] font-bold leading-none tracking-[-0.01em] tabular-nums">
                  {failed ? "—" : value.toLocaleString()}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Two-column zone: recent inspections (dominant) + right stack */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[2fr_1fr]">
        {/* Inspeksi Terbaru */}
        <section className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-4 py-3">
            <p className="micro-label">INSPEKSI TERBARU</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No Lot</TableHead>
                <TableHead>Produk</TableHead>
                <TableHead className="text-right">Tanggal</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recent_inspeksi.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-data">{row.no_lot}</TableCell>
                  <TableCell className="text-muted">
                    {row.master_produk?.nama_produk || "-"}
                  </TableCell>
                  <TableCell className="font-data text-right">
                    {row.tgl_uji}
                  </TableCell>
                  <TableCell className="text-right">
                    <StatusBadge status={row.status} />
                  </TableCell>
                </TableRow>
              ))}
              {(failedKeys.includes("recent_inspeksi") ||
                data.recent_inspeksi.length === 0) && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-8 text-center text-muted"
                  >
                    {failedKeys.includes("recent_inspeksi")
                      ? "Gagal memuat data inspeksi."
                      : "Belum ada data inspeksi."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </section>

        {/* Right stack: pass-rate ring + documents */}
        <div className="flex flex-col gap-6">
          <section className="rounded-lg border border-border bg-surface p-4">
            <p className="micro-label">TINGKAT KELULUSAN</p>
            <div className="mt-4">
              <DonutChart
                passRate={passRate}
                failRate={failRate}
                passCount={data.lot_pass}
                failCount={data.lot_fail}
                failed={lotFailed}
              />
            </div>
          </section>

          <section className="rounded-lg border border-border bg-surface p-4">
            <p className="micro-label">DOKUMEN</p>
            <div className="mt-4 grid grid-cols-2">
              <div className="pr-4">
                <DotChip tone="warning">Berlaku</DotChip>
                <p className="mt-2 text-[28px] font-bold leading-none tracking-[-0.01em] tabular-nums">
                  {dokBerlaku}
                </p>
              </div>
              <div className="border-l border-border-soft pl-4">
                <DotChip tone="danger">Kadaluarsa</DotChip>
                <p className="mt-2 text-[28px] font-bold leading-none tracking-[-0.01em] tabular-nums">
                  {dokExpired}
                </p>
              </div>
            </div>
            <Link
              href="/dashboard/arsip"
              className="mt-4 inline-flex items-center gap-2 rounded-[4px] text-[13px] font-medium text-muted transition-colors duration-150 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              Kelola dokumen
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}
