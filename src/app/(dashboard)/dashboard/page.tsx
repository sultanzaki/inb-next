"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { HasilUji, DashboardData } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
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
  Package,
  FlaskConical,
  CheckCircle2,
  XCircle,
  FileText,
  FolderArchive,
} from "lucide-react";

const statCards = [
  {
    key: "total_produk",
    label: "Total Produk",
    icon: Package,
    bg: "bg-emerald-50",
    text: "text-emerald-600",
    iconColor: "#059669",
  },
  {
    key: "total_lot",
    label: "Lot Diuji",
    icon: FlaskConical,
    bg: "bg-blue-50",
    text: "text-blue-600",
    iconColor: "#2563eb",
  },
  {
    key: "lot_pass",
    label: "Lot PASS",
    icon: CheckCircle2,
    bg: "bg-emerald-50",
    text: "text-emerald-600",
    iconColor: "#059669",
  },
  {
    key: "lot_fail",
    label: "Lot FAIL",
    icon: XCircle,
    bg: "bg-red-50",
    text: "text-red-600",
    iconColor: "#dc2626",
  },
  {
    key: "total_coa",
    label: "COA Terbit",
    icon: FileText,
    bg: "bg-violet-50",
    text: "text-violet-600",
    iconColor: "#7c3aed",
  },
  {
    key: "dok_berlaku",
    label: "Dokumen",
    icon: FolderArchive,
    bg: "bg-amber-50",
    text: "text-amber-600",
    iconColor: "#d97706",
  },
];

function statusBadge(status: string) {
  if (status === "PASS")
    return (
      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50">
        PASS
      </Badge>
    );
  return (
    <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 hover:bg-red-50">
      FAIL
    </Badge>
  );
}

function DonutChart({
  passRate,
  failRate,
  passCount,
  failCount,
}: {
  passRate: number;
  failRate: number;
  passCount: number;
  failCount: number;
}) {
  const circumference = 2 * Math.PI * 42;
  const passOffset = circumference - (passRate / 100) * circumference;
  const failOffset = circumference - (failRate / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-36 h-36">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="#f1f5f9"
            strokeWidth="10"
          />
          {passRate > 0 && (
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="#047857"
              strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={passOffset}
              strokeLinecap="round"
              className="transition-all duration-700 ease-out"
            />
          )}
          {failRate > 0 && (
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="#b91c1c"
              strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={failOffset}
              strokeLinecap="round"
              className="transition-all duration-700 ease-out"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tracking-tight">{passRate}%</span>
          <span className="text-[11px] text-muted-foreground font-medium">
            PASS
          </span>
        </div>
      </div>
      <div className="flex items-center gap-5 mt-3 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
          <span className="text-muted-foreground">
            PASS <span className="font-semibold text-foreground">{passCount}</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-600" />
          <span className="text-muted-foreground">
            FAIL <span className="font-semibold text-foreground">{failCount}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-white p-5 shadow-xs">
      <div className="flex items-start gap-4">
        <Skeleton className="size-10 rounded-lg shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-16" />
        </div>
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-white shadow-xs">
      <div className="px-5 py-4 border-b border-border">
        <Skeleton className="h-4 w-36" />
      </div>
      <div className="p-5 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [greeting, setGreeting] = useState("");

  useEffect(() => {
    const h = new Date().getHours();
    if (h < 12) setGreeting("Selamat Pagi");
    else if (h < 15) setGreeting("Selamat Siang");
    else if (h < 18) setGreeting("Selamat Sore");
    else setGreeting("Selamat Malam");
  }, []);

  const fetchData = useCallback(async () => {
    const sb = createClient();

    const [
      { count: total_produk },
      { count: total_lot },
      { count: lot_pass },
      { count: lot_fail },
      { count: total_coa },
      { count: total_dok },
      { data: hasilRaw },
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
        .gte("masa_kadaluarsa", new Date().toISOString().split("T")[0]),
      sb
        .from("hasil_uji")
        .select("*, master_produk!inner(kode_produk, nama_produk)")
        .order("created_at", { ascending: false })
        .limit(8),
    ]);

    const { count: dok_expired } = await sb
      .from("dokumen_arsip")
      .select("*", { count: "exact", head: true })
      .lt("masa_kadaluarsa", new Date().toISOString().split("T")[0]);

    setData({
      total_produk: total_produk ?? 0,
      total_lot: total_lot ?? 0,
      lot_pass: lot_pass ?? 0,
      lot_fail: lot_fail ?? 0,
      total_coa: total_coa ?? 0,
      dok_berlaku: total_dok ?? 0,
      dok_expired: dok_expired ?? 0,
      recent_inspeksi: (hasilRaw as unknown as HasilUji[]) ?? [],
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        {/* Greeting skeleton */}
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-44" />
        </div>

        {/* Stat cards skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>

        {/* Donut + table skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="rounded-xl border border-border bg-white p-6 shadow-xs">
            <Skeleton className="h-4 w-32 mb-6" />
            <div className="flex flex-col items-center gap-4">
              <Skeleton className="size-36 rounded-full" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
          <div className="lg:col-span-2">
            <TableSkeleton />
          </div>
        </div>
      </div>
    );
  }

  const total = data.lot_pass + data.lot_fail;
  const passRate = total > 0 ? Math.round((data.lot_pass / total) * 100) : 0;
  const failRate = total > 0 ? Math.round((data.lot_fail / total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{greeting}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ringkasan sistem quality control.
        </p>
      </div>

      {/* KPI stat cards — 3x2 grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map((s) => {
          const Icon = s.icon;
          const value = data[s.key as keyof DashboardData] as number;
          return (
            <div
              key={s.key}
              className="rounded-xl border border-border bg-white p-5 shadow-xs transition-all duration-200 hover:shadow-md hover:border-foreground/10"
            >
              <div className="flex items-start gap-4">
                <div
                  className={`${s.bg} ${s.text} flex size-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-black/5`}
                >
                  <Icon className="size-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {s.label}
                  </p>
                  <p className="text-2xl font-bold tracking-tight mt-0.5">
                    {value.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Donut chart + Recent inspections table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pass/Fail ring chart */}
        <div className="rounded-xl border border-border bg-white shadow-xs p-5 lg:p-6 flex flex-col items-center justify-center">
          <h3 className="text-sm font-semibold self-start mb-5">
            Tingkat Kelulusan
          </h3>
          <DonutChart
            passRate={passRate}
            failRate={failRate}
            passCount={data.lot_pass}
            failCount={data.lot_fail}
          />
        </div>

        {/* Inspeksi Terbaru table */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-white shadow-xs">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-sm font-semibold">Inspeksi Terbaru</h3>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                  No Lot
                </TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                  Produk
                </TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                  Tanggal
                </TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-muted-foreground text-right">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recent_inspeksi.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.no_lot}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {(row as any).master_produk?.nama_produk ||
                      row.nama_produk ||
                      "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.tgl_uji}
                  </TableCell>
                  <TableCell className="text-right">
                    {statusBadge(row.status)}
                  </TableCell>
                </TableRow>
              ))}
              {data.recent_inspeksi.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Belum ada data inspeksi.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
