"use client";
import { useEffect, useRef, useState } from "react";
import { FilePenLine, Trash2, ArrowRight } from "lucide-react";
import type { InspectionDraft } from "@/lib/types";
import { deleteDraftAction } from "@/lib/actions/inspeksi-actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "./confirm-provider";
import { toast } from "sonner";
export function DraftPanel({
  refresh,
  onResume,
}: {
  refresh: number;
  onResume: (draft: InspectionDraft) => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [data, setData] = useState<InspectionDraft[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(false),
    [retry, setRetry] = useState(0),
    [busy, setBusy] = useState(""),
    [page, setPage] = useState(0),
    [more, setMore] = useState(false);
  const confirm = useConfirm(),
    seq = useRef(0);
  useEffect(() => {
    const sequence = seq;
    const id = ++sequence.current,
      controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(
          "/api/data/inspection_drafts?" +
            new URLSearchParams({
              select: "id,no_lot,updated_at",
              order: "updated_at.desc,id.asc",
              offset: String(page * 50),
              limit: "51",
            }),
          { signal: controller.signal },
        );
        if (!r.ok) throw Error();
        const rows: InspectionDraft[] = await r.json();
        if (id === sequence.current) {
          setData(rows.slice(0, 50));
          setMore(rows.length > 50);
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted && id === sequence.current)
          setError(true);
      } finally {
        if (id === sequence.current) setLoading(false);
      }
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
      sequence.current++;
    };
  }, [refresh, retry, page]);
  return (
    <section className="draft-panel">
      <button
        type="button"
        className="draft-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <FilePenLine className="size-4" />
        <span>Draft inspeksi</span>
        <span className="ml-1 text-muted">
          {loading ? "…" : error ? "—" : data.length + (more ? "+" : "")}
        </span>
        <span className="ml-auto text-xs text-primary">
          {open ? "Tutup" : "Lihat draft"}
        </span>
      </button>
      {open && (
        <div className="draft-list">
          {error ? (
            <div role="alert" className="text-sm text-danger">
              Draft belum berhasil dimuat.
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRetry((v) => v + 1)}
              >
                Coba lagi
              </Button>
            </div>
          ) : loading ? (
            <p role="status" className="text-sm text-muted">
              Memuat draft…
            </p>
          ) : data.length === 0 ? (
            <p className="text-sm text-muted">
              Belum ada draft. Anda dapat menyimpan pengujian yang belum lengkap
              dari formulir inspeksi.
            </p>
          ) : (
            data.map((draft) => (
              <div className="draft-row" key={draft.id}>
                <div>
                  <p className="text-sm font-medium">
                    {draft.no_lot || "Tanpa nomor lot"}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Diperbarui{" "}
                    {new Intl.DateTimeFormat("id-ID", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Asia/Jakarta",
                    }).format(new Date(draft.updated_at))}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    loading={busy === draft.id + "resume"}
                    disabled={Boolean(busy)}
                    onClick={async () => {
                      setBusy(draft.id + "resume");
                      try {
                        const response = await fetch(
                          "/api/data/inspection_drafts?" +
                            new URLSearchParams({
                              select: "*",
                              id: "eq." + draft.id,
                              limit: "1",
                            }),
                        );
                        if (!response.ok) throw Error();
                        const rows = await response.json();
                        if (!rows[0]) throw Error();
                        await onResume(rows[0]);
                      } catch {
                        toast.error("Draft tidak dapat dimuat. Coba lagi.");
                      } finally {
                        setBusy("");
                      }
                    }}
                  >
                    Lanjutkan
                    <ArrowRight className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Hapus draft"
                    disabled={Boolean(busy)}
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: "Hapus draft inspeksi?",
                          description:
                            "Isian draft ini akan dihapus. Hasil inspeksi final tetap tersimpan.",
                        }))
                      )
                        return;
                      setBusy(draft.id);
                      try {
                        const r = await deleteDraftAction(draft.id);
                        if (!r.ok) {
                          toast.error(r.error);
                          return;
                        }
                        setData((v) => v.filter((x) => x.id !== draft.id));
                        toast.success("Draft dihapus.");
                      } catch {
                        toast.error("Gagal menghapus draft.");
                      } finally {
                        setBusy("");
                      }
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
          {!loading && !error && (page > 0 || more) && (
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((v) => v - 1)}
              >
                Sebelumnya
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!more}
                onClick={() => setPage((v) => v + 1)}
              >
                Berikutnya
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
