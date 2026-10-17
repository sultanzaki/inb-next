"use client";
import { useEffect, useState } from "react";
import type { SpecVersion, SpesifikasiItem } from "@/lib/types";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
function signature(s: SpesifikasiItem) {
  return JSON.stringify([
    s.tipe_batas,
    s.nilai_min,
    s.nilai_maks,
    s.satuan,
    s.keterangan,
    s.parameter_en || "",
    s.keterangan_en || "",
  ]);
}
export function SpecHistory({
  productId,
  current,
}: {
  productId: string;
  current: SpesifikasiItem[];
}) {
  const [versions, setVersions] = useState<SpecVersion[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(false),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0),
    [hasMore, setHasMore] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(
          "/api/data/product_spec_versions?" +
            new URLSearchParams({
              select: "*",
              id_produk: "eq." + productId,
              order: "version.desc",
              limit: "50",
            }),
          { signal: controller.signal },
        );
        if (!r.ok) throw Error();
        const rows = await r.json();
        setVersions(rows);
        setSelected(rows[0]?.id || "");
        setHasMore(rows.length === 50);
        setError(false);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 0);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [productId, retry]);
  const version = versions.find((v) => v.id === selected),
    historic = version?.specifications || [];
  const changes = historic
    .map((s) => {
      const active = current.find(
        (x) => x.parameter_uji.toLowerCase() === s.parameter_uji.toLowerCase(),
      );
      return !active
        ? `${s.parameter_uji}: tidak ada di versi aktif`
        : signature(active) !== signature(s)
          ? `${s.parameter_uji}: standar berbeda dari versi aktif`
          : null;
    })
    .filter(Boolean);
  const added = current
    .filter(
      (s) =>
        !historic.some(
          (h) =>
            h.parameter_uji.toLowerCase() === s.parameter_uji.toLowerCase(),
        ),
    )
    .map((s) => `${s.parameter_uji}: ditambahkan setelah versi ini`);
  return (
    <section className="spec-history">
      <h3 className="text-sm font-semibold">Riwayat versi spesifikasi</h3>
      {loading ? (
        <p role="status" className="py-5 text-xs text-muted">
          Memuat riwayat…
        </p>
      ) : error ? (
        <div role="alert" className="py-4 text-xs text-danger">
          Riwayat belum berhasil dimuat.
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRetry((v) => v + 1)}
          >
            Coba lagi
          </Button>
        </div>
      ) : versions.length === 0 ? (
        <p className="mt-4 text-xs text-muted">Riwayat versi belum tersedia.</p>
      ) : (
        <>
          <label className="form-label mt-4">
            Versi
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  Versi {v.version} ·{" "}
                  {new Intl.DateTimeFormat("id-ID", {
                    dateStyle: "medium",
                    timeZone: "Asia/Jakarta",
                  }).format(new Date(v.created_at))}
                </option>
              ))}
            </select>
          </label>
          {version && (
            <>
              <p className="my-4 text-xs leading-relaxed text-muted">
                Oleh {version.actor}
                {version.revision_note && <> · {version.revision_note}</>}
              </p>
              <p className="mb-3 text-xs text-muted">
                Produk saat versi ini: {version.product_snapshot.nama_produk} ·{" "}
                {version.product_snapshot.kode_produk}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Parameter</TableHead>
                    <TableHead>Standar</TableHead>
                    <TableHead>Satuan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historic.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.parameter_uji}</TableCell>
                      <TableCell>
                        {s.tipe_batas === "TEXT"
                          ? s.keterangan || "Observasi"
                          : s.tipe_batas === "MIN"
                            ? `≥ ${s.nilai_min}`
                            : s.tipe_batas === "MAX"
                              ? `≤ ${s.nilai_maks}`
                              : `${s.nilai_min} – ${s.nilai_maks}`}
                      </TableCell>
                      <TableCell>{s.satuan || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <details className="mt-4 rounded-lg bg-surface-alt p-4">
                <summary className="cursor-pointer text-xs font-medium">
                  Perbedaan dengan versi aktif
                </summary>
                <ul className="mt-3 space-y-2 text-xs text-muted">
                  {changes.length || added.length ? (
                    [...changes, ...added].map((c, i) => <li key={i}>{c}</li>)
                  ) : (
                    <li>Parameter dan standar sama dengan versi aktif.</li>
                  )}
                </ul>
              </details>
            </>
          )}
          {hasMore && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={async () => {
                try {
                  const r = await fetch(
                    "/api/data/product_spec_versions?" +
                      new URLSearchParams({
                        select: "*",
                        id_produk: "eq." + productId,
                        order: "version.desc",
                        limit: "50",
                        offset: String(versions.length),
                      }),
                  );
                  if (!r.ok) throw Error();
                  const rows = await r.json();
                  setVersions((v) => [...v, ...rows]);
                  setHasMore(rows.length === 50);
                } catch {
                  setError(true);
                }
              }}
            >
              Muat versi sebelumnya
            </Button>
          )}
        </>
      )}
    </section>
  );
}
