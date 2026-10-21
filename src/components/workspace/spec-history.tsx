"use client";
import { requestTimeout } from "@/lib/request-timeout";
import { RecordSkeleton } from "./record-loading";
import { useEffect, useState } from "react";
import type { SpecVersion, SpesifikasiItem } from "@/lib/types";
import { SpecificationParameters } from "./specification-parameters";
import { Button } from "@/components/ui/button";
import { DataPagination } from "./page-ui";
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
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      const timeout = requestTimeout(controller.signal);
      try {
        const r = await fetch(
          "/api/data/product_spec_versions?" +
            new URLSearchParams({
              select: "*",
              id_produk: "eq." + productId,
              order: "version.desc",
              limit: "50",
              offset: String((page - 1) * 50),
            }),
          {
            signal: timeout.signal,
            headers: { Prefer: "count=exact" },
          },
        );
        if (!r.ok) throw Error();
        const rows = await r.json();
        setVersions(rows);
        setSelected(rows[0]?.id || "");
        setTotal(
          Number(r.headers.get("content-range")?.split("/")[1] || rows.length),
        );
        setError(false);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        timeout.dispose();
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 0);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [productId, retry, page]);
  const version = versions.find((v) => v.id === selected),
    historic = version?.specifications || [];
  const changes = historic
    .map((s) => {
      const active = current.find(
        (x) => x.parameter_uji.toLowerCase() === s.parameter_uji.toLowerCase(),
      );
      return !active
        ? `${s.parameter_uji}: removed from the current version`
        : signature(active) !== signature(s)
          ? `${s.parameter_uji}: standard differs from the current version`
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
    .map((s) => `${s.parameter_uji}: added after this version`);
  return (
    <section className="spec-history">
      <h3 className="text-sm font-semibold">Specification history</h3>
      {loading ? (
        <RecordSkeleton compact label="Loading specification history…" />
      ) : error ? (
        <div role="alert" className="py-4 text-xs text-danger">
          Could not load version history.
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRetry((v) => v + 1)}
          >
            Retry
          </Button>
        </div>
      ) : versions.length === 0 ? (
        <p className="mt-4 text-xs text-muted">No version history yet.</p>
      ) : (
        <>
          <label className="form-label mt-4">
            Version
            <select
              aria-label="Specification version"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  Version {v.version} ·{" "}
                  {new Intl.DateTimeFormat("en-GB", {
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
                By {version.actor}
                {version.revision_note && <> · {version.revision_note}</>}
              </p>
              <p className="mb-3 text-xs text-muted">
                Product in this version: {version.product_snapshot.nama_produk}{" "}
                · {version.product_snapshot.kode_produk}
              </p>
              <SpecificationParameters items={historic} />
              <details className="mt-4 rounded-lg bg-surface-alt p-4">
                <summary className="cursor-pointer text-xs font-medium">
                  Changes from the current version
                </summary>
                <ul className="mt-3 space-y-2 text-xs text-muted">
                  {changes.length || added.length ? (
                    [...changes, ...added].map((c, i) => <li key={i}>{c}</li>)
                  ) : (
                    <li>Parameters match the current version.</li>
                  )}
                </ul>
              </details>
            </>
          )}
          <DataPagination
            count={versions.length}
            total={total}
            page={page}
            pageSize={50}
            loading={loading}
            onPageChange={(next) => {
              setLoading(true);
              setPage(next);
            }}
          />
        </>
      )}
    </section>
  );
}
