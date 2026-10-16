"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Package,
  ClipboardList,
  FileCheck2,
  ArrowUpRight,
  ArrowRight,
  CheckCheck,
  RefreshCw,
  FolderArchive,
  AlertTriangle,
  CalendarDays,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { businessDate } from "@/lib/domain/validation";
import { useUser } from "../user-context";
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
  const { user } = useUser();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [failedKeys, setFailedKeys] = useState<string[]>([]);
  const [dateLabel, setDateLabel] = useState("");
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setDateLabel(
          new Intl.DateTimeFormat("id-ID", {
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
      <div className="page-stack" role="status" aria-label="Memuat dashboard">
        <div className="space-y-3">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="stat-grid">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  const resultFailed =
    failedKeys.includes("lot_pass") || failedKeys.includes("lot_fail");
  const total = data.lot_pass + data.lot_fail;
  const passRate = total ? Math.round((data.lot_pass / total) * 1000) / 10 : 0;
  const metrics = [
    {
      key: "total_produk",
      label: "Total produk",
      value: data.total_produk,
      note: "Katalog produk terdaftar",
      icon: Package,
      href: "/dashboard/produk",
    },
    {
      key: "total_lot",
      label: "Lot diuji",
      value: data.total_lot,
      note: "Seluruh hasil inspeksi",
      icon: ClipboardList,
      href: "/dashboard/inspeksi",
    },
    {
      key: "lot_pass",
      label: "Tingkat kelulusan",
      value: resultFailed ? "—" : total ? `${passRate}%` : "—",
      note: resultFailed
        ? "Data belum tersedia"
        : `${data.lot_pass} lot memenuhi standar`,
      icon: CheckCheck,
      href: "/dashboard/inspeksi",
    },
    {
      key: "total_coa",
      label: "COA diterbitkan",
      value: data.total_coa,
      note: "Sertifikat analisis tercatat",
      icon: FileCheck2,
      href: "/dashboard/coa",
    },
  ];
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Ringkasan ruang kerja"
        title="Dashboard"
        description={`Selamat datang${user?.nama_lengkap ? `, ${user.nama_lengkap.split(" ")[0]}` : ""}. Berikut gambaran pengendalian mutu Anda.`}
      >
        <span className="mr-2 hidden items-center gap-2 text-xs text-muted xl:inline-flex">
          <CalendarDays className="size-3.5" />
          {dateLabel}
        </span>
        <Button
          variant="outline"
          loading={loading}
          onClick={() => void fetchData()}
        >
          <RefreshCw className="size-3.5" />
          Perbarui
        </Button>
      </PageHeader>
      {loadError && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Beberapa data belum tersedia</AlertTitle>
          <AlertDescription>
            Angka bertanda — belum berhasil dimuat. Coba muat ulang.
          </AlertDescription>
          <AlertAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchData()}
            >
              Coba Lagi
            </Button>
          </AlertAction>
        </Alert>
      )}
      <div className="stat-grid">
        {metrics.map(({ key, label, value, note, icon: Icon, href }) => (
          <Link href={href} key={key} className="stat-card">
            <div className="stat-card-head">
              <span className="stat-label">{label}</span>
              <span className="stat-icon">
                <Icon className="size-[18px]" />
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="stat-value">
                {failedKeys.includes(key)
                  ? "—"
                  : typeof value === "number"
                    ? value.toLocaleString("id-ID")
                    : value}
              </span>
              <ArrowUpRight className="size-4 text-faint" />
            </div>
            <p className="stat-note">{note}</p>
          </Link>
        ))}
      </div>
      <div className="dashboard-grid">
        <div className="space-y-5">
          <section className="data-card">
            <div className="data-card-header">
              <div>
                <h2 className="data-card-title">Inspeksi terbaru</h2>
                <p className="data-card-description">
                  Delapan pengujian terakhir di ruang kerja Anda.
                </p>
              </div>
              <Link
                href="/dashboard/inspeksi"
                className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-primary"
              >
                Lihat semua
                <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
            <Table className="dashboard-recent-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Nomor lot</TableHead>
                  <TableHead>Produk</TableHead>
                  <TableHead>Tanggal uji</TableHead>
                  <TableHead className="text-right">Hasil</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recent_inspeksi.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="entity-cell">
                        <span className="entity-icon">
                          <ClipboardList className="size-4" />
                        </span>
                        <span
                          className="min-w-0 truncate font-data text-xs"
                          title={row.no_lot}
                        >
                          {row.no_lot}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p
                        className="truncate text-xs font-medium"
                        title={row.master_produk?.nama_produk}
                      >
                        {row.master_produk?.nama_produk || "—"}
                      </p>
                      <p
                        className="mt-1 truncate text-[10px] text-muted"
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
                      <ClipboardList className="mx-auto mb-3 size-7 text-primary" />
                      <p className="text-sm font-medium">
                        {failedKeys.includes("recent_inspeksi")
                          ? "Data inspeksi belum tersedia"
                          : "Belum ada inspeksi"}
                      </p>
                      <p className="mt-2 text-xs text-muted">
                        Mulai dari produk dan spesifikasi, lalu catat pengujian
                        lot pertama.
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </section>
          <section className="data-card">
            <div className="data-card-header">
              <div>
                <h2 className="data-card-title">
                  Satu alur, kualitas terjaga.
                </h2>
                <p className="data-card-description">
                  Lanjutkan pekerjaan dari tahap yang Anda butuhkan.
                </p>
              </div>
            </div>
            <div className="grid gap-3 p-5 sm:grid-cols-3">
              {[
                {
                  href: "/dashboard/produk",
                  icon: Package,
                  label: "Standar produk",
                  copy: "Tentukan spesifikasi uji.",
                },
                {
                  href: "/dashboard/inspeksi",
                  icon: ClipboardList,
                  label: "Pengujian lot",
                  copy: "Catat dan evaluasi hasil.",
                },
                {
                  href: "/dashboard/coa",
                  icon: FileCheck2,
                  label: "Sertifikasi",
                  copy: "Terbitkan hasil yang lulus.",
                },
              ].map(({ href, icon: Icon, label, copy }, i) => (
                <Link
                  key={href}
                  href={href}
                  className="quick-link !items-start !gap-2.5"
                >
                  <span className="mt-0.5 text-[11px] font-semibold text-primary">
                    0{i + 1}
                  </span>
                  <div>
                    <Icon className="mb-3 size-4 text-primary" />
                    <p className="text-xs font-semibold">{label}</p>
                    <p className="mt-1 text-[10px] leading-relaxed text-muted">
                      {copy}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </div>
        <div className="space-y-5">
          <section className="data-card">
            <div className="data-card-header">
              <div>
                <h2 className="data-card-title">Distribusi hasil uji</h2>
                <p className="data-card-description">
                  Gambaran kelulusan seluruh lot.
                </p>
              </div>
              <CheckCheck className="size-4 text-muted" />
            </div>
            <div className="flex flex-col items-center px-6 py-7">
              <div
                className="quality-ring"
                style={{
                  background:
                    resultFailed || !total
                      ? "var(--color-chip-bg)"
                      : `conic-gradient(var(--color-primary) 0% ${passRate}%, var(--color-danger) ${passRate}% 100%)`,
                }}
                role="img"
                aria-label={
                  resultFailed
                    ? "Data hasil uji belum tersedia"
                    : `${data.lot_pass} lot PASS dan ${data.lot_fail} lot FAIL`
                }
              >
                <div className="quality-ring-value">
                  <span className="text-[30px] font-semibold tracking-[-.05em]">
                    {resultFailed || !total ? "—" : `${passRate}%`}
                  </span>
                  <span className="mt-1 text-[10px] text-muted">
                    Tingkat kelulusan
                  </span>
                </div>
              </div>
              <div className="mt-7 w-full space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 text-muted">
                    <span className="size-2 rounded-full bg-primary" />
                    Lulus / PASS
                  </span>
                  <strong className="font-data">
                    {resultFailed ? "—" : data.lot_pass.toLocaleString("id-ID")}
                  </strong>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 text-muted">
                    <span className="size-2 rounded-full bg-danger" />
                    Tidak lulus / FAIL
                  </span>
                  <strong className="font-data">
                    {resultFailed ? "—" : data.lot_fail.toLocaleString("id-ID")}
                  </strong>
                </div>
              </div>
              {!total && !resultFailed && (
                <p className="mt-5 text-center text-xs text-muted">
                  Distribusi akan muncul setelah inspeksi pertama.
                </p>
              )}
            </div>
          </section>
          <section className="data-card">
            <div className="data-card-header">
              <h2 className="data-card-title">Dokumen & kepatuhan</h2>
              <FolderArchive className="size-4 text-muted" />
            </div>
            <div className="space-y-4 p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">Dokumen berlaku</span>
                <Badge>
                  {failedKeys.includes("dok_berlaku") ? "—" : data.dok_berlaku}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">Perlu ditinjau</span>
                <Badge variant={data.dok_expired ? "destructive" : "secondary"}>
                  {failedKeys.includes("dok_expired") ? "—" : data.dok_expired}
                </Badge>
              </div>
              <Link
                href="/dashboard/arsip"
                className="mt-3 flex items-center justify-between border-t border-border-soft pt-4 text-xs font-medium text-primary"
              >
                Kelola arsip dokumen
                <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
