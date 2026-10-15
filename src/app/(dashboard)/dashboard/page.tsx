"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { HasilUji, DashboardData } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import {
  Package,
  FlaskConical,
  CheckCircle2,
  XCircle,
  FileText,
  FolderArchive,
} from "lucide-react";

const iconMap: Record<string, React.ReactNode> = {
  produk: <Package className="size-5" />,
  lot: <FlaskConical className="size-5" />,
  pass: <CheckCircle2 className="size-5 text-emerald-600" />,
  fail: <XCircle className="size-5 text-red-600" />,
  coa: <FileText className="size-5" />,
  dok: <FolderArchive className="size-5" />,
};

const statIcons: Record<
  string,
  { icon: React.ReactNode; bg: string }
> = {
  total_produk: { icon: iconMap.produk, bg: "bg-emerald-50 text-emerald-700" },
  total_lot: { icon: iconMap.lot, bg: "bg-blue-50 text-blue-700" },
  lot_pass: { icon: iconMap.pass, bg: "bg-emerald-50 text-emerald-700" },
  lot_fail: { icon: iconMap.fail, bg: "bg-red-50 text-red-700" },
  total_coa: { icon: iconMap.coa, bg: "bg-violet-50 text-violet-700" },
  dok_berlaku: { icon: iconMap.dok, bg: "bg-amber-50 text-amber-700" },
};

function statusBadge(status: string) {
  if (status === "PASS")
    return (
      <Badge
        variant="outline"
        className="bg-emerald-50 text-emerald-700 border-emerald-200"
      >
        PASS
      </Badge>
    );
  return (
    <Badge
      variant="outline"
      className="bg-red-50 text-red-700 border-red-200"
    >
      FAIL
    </Badge>
  );
}

function StatCard({
  label,
  value,
  icon,
  bg,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  bg: string;
}) {
  return (
    <div className="stat-card">
      <div className="flex items-center justify-between">
        <span className="stat-label">{label}</span>
        <div className={`stat-icon ${bg}`}>{icon}</div>
      </div>
      <div className="stat-value">{value}</div>
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

    // fetch expired count separately
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
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
        Memuat data…
      </div>
    );
  }

  const total = data.lot_pass + data.lot_fail;
  const passRate = total > 0 ? Math.round((data.lot_pass / total) * 100) : 0;
  const failRate = total > 0 ? Math.round((data.lot_fail / total) * 100) : 0;

  const stats = [
    { key: "total_produk", label: "Total Produk", value: data.total_produk },
    { key: "total_lot", label: "Lot Diuji", value: data.total_lot },
    { key: "lot_pass", label: "Lot PASS", value: data.lot_pass },
    { key: "lot_fail", label: "Lot FAIL", value: data.lot_fail },
    { key: "total_coa", label: "COA Terbit", value: data.total_coa },
    { key: "dok_berlaku", label: "Dokumen Berlaku", value: data.dok_berlaku },
  ];

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-xl font-bold">{greeting}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Ringkasan sistem quality control.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map((s) => {
          const meta = statIcons[s.key];
          return (
            <StatCard
              key={s.key}
              label={s.label}
              value={s.value}
              icon={meta.icon}
              bg={meta.bg}
            />
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pass/Fail ring */}
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Tingkat Kelulusan</span>
          </div>
          <div className="p-5 flex items-center justify-center">
            <div className="relative w-40 h-40">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                {/* Background circle */}
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  fill="none"
                  stroke="#e5e9ef"
                  strokeWidth="10"
                />
                {/* PASS arc */}
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  fill="none"
                  stroke="#047857"
                  strokeWidth="10"
                  strokeDasharray={`${passRate * 3.267} 326.7`}
                  strokeLinecap="round"
                />
                {/* FAIL arc */}
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  fill="none"
                  stroke="#b91c1c"
                  strokeWidth="10"
                  strokeDasharray={`${failRate * 3.267} 326.7`}
                  strokeDashoffset={`${-passRate * 3.267}`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold">{passRate}%</span>
                <span className="text-xs text-muted-foreground">PASS</span>
              </div>
            </div>
            <div className="ml-6 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-emerald-600" />
                <span className="text-sm">
                  PASS{" "}
                  <span className="font-semibold">{data.lot_pass}</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-600" />
                <span className="text-sm">
                  FAIL{" "}
                  <span className="font-semibold">{data.lot_fail}</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Recent inspeksi table */}
        <div className="panel lg:col-span-2">
          <div className="panel-head">
            <span className="panel-title">Inspeksi Terbaru</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
                  <th className="text-left px-4 py-2.5 font-medium">No Lot</th>
                  <th className="text-left px-4 py-2.5 font-medium">Produk</th>
                  <th className="text-left px-4 py-2.5 font-medium">Tanggal</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_inspeksi.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-2.5 font-medium">{row.no_lot}</td>
                    <td className="px-4 py-2.5">
                      {(row as any).master_produk?.nama_produk || row.nama_produk || "-"}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {row.tgl_uji}
                    </td>
                    <td className="px-4 py-2.5">
                      {statusBadge(row.status)}
                    </td>
                  </tr>
                ))}
                {data.recent_inspeksi.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      Belum ada data inspeksi.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
