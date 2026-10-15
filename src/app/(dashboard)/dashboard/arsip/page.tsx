"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "../../user-context";
import { canAction } from "@/lib/types";
import type { DokumenArsip, UserRole } from "@/lib/types";
import { toast } from "sonner";
import { uploadDokumenAction, deleteDokumenAction } from "@/lib/actions/arsip-actions";
import { Search, Plus, Trash2, ExternalLink, FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/table-skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

// Module-level browser client: a single instance instead of one per render.
const sb = createClient();

// Monotonic counter used to ignore stale list-fetch responses (fast typing
// through the debounced search).
let requestSeq = 0;

const kategoriDocList = [
  "Sertifikat Halal",
  "Sertifikat BPOM",
  "Sertifikat Mutu",
  "SOP",
  "Kebijakan Mutu",
  "Laporan Audit",
  "Kontrak",
  "Lainnya",
];

// Local calendar date as YYYY-MM-DD. Built from the local getters with
// padStart — NOT toISOString(), which yields the UTC date and is off by a
// day in UTC+7 afternoons.
function localTodayStr(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

// Escape a raw search term for a PostgREST .or() ilike filter. The PostgREST
// v12 quoted-value parser strips ONE backslash from EVERY "\X" pair
// unconditionally, and Postgres LIKE then consumes one more level, so each
// special character ships with two spare backslashes:
//   \ -> \\\\  (parser: \\\\ -> \\ ; LIKE: \\ -> literal \)
//   " -> \"    (parser: \" -> " ; keeps the quoted value intact)
//   % -> \\\%  (parser: \\\% -> \% ; LIKE: \% -> literal %)
//   _ -> \\_   (parser: \\_ -> \_ ; LIKE: \_ -> literal _)
// The escaped term is placed inside double quotes in the filter itself: the
// grammar treats , and ) as syntax only in bare values, while a quoted value
// keeps them literal (a bare value like "%a,b%" would truncate at the comma
// -> PGRST100 400).
function escapeOr(value: string): string {
  return value
    .replace(/\\/g, "\\\\\\\\")
    .replace(/"/g, '\\"')
    .replace(/%/g, "\\\\\\%")
    .replace(/_/g, "\\\\_");
}

interface DocForm {
  judul_dokumen: string;
  kategori: string;
  tanggal_berlaku: string;
  masa_kadaluarsa: string;
  link_drive: string;
}

const emptyForm: DocForm = {
  judul_dokumen: "",
  kategori: "",
  tanggal_berlaku: localTodayStr(),
  masa_kadaluarsa: "",
  link_drive: "",
};

// Render-side allowlist mirroring uploadDokumenAction: only http(s) links
// become anchors, so a legacy javascript:/data: row can never be clicked.
function safeHref(link: string): string | null {
  const trimmed = link.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

// Status is always a dot-chip: success tint while valid, danger once expired.
function StatusDocBadge({ expired }: { expired: boolean }) {
  if (expired) {
    return (
      <span className="inline-flex items-center gap-2 rounded-[4px] bg-danger-bg px-2 py-1 text-[11.5px] font-medium leading-tight text-danger-dark">
        <span className="size-[5px] rounded-full bg-danger" aria-hidden="true" />
        Kadaluarsa
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-[4px] bg-success-bg px-2 py-1 text-[11.5px] font-medium leading-tight text-success-dark">
      <span className="size-[5px] rounded-full bg-success" aria-hidden="true" />
      Berlaku
    </span>
  );
}

// Native select styled to match the Input kit (hairline border, 36px, 6px
// radius); focus border + ring come from the global input/select rule.
const selectClass =
  "h-9 w-full rounded-md border border-input bg-surface px-2.5 text-sm transition-colors duration-150 outline-none";

export default function DokumenPage() {
  const { user } = useUser();

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dokumenList, setDokumenList] = useState<DokumenArsip[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<DocForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  // Pagination: list queries are bounded with .range(); count:"exact" returns
  // the filtered row total (ignoring the range window) in the same request, so
  // "Muat lagi" knows how many rows are left without a second query.
  const [pageSize] = useState(50);
  const [offset, setOffset] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  // Bounded query runner shared by the fresh fetch and load-more.
  // append=false swaps the accumulated list (mount, search, retry, after a
  // mutation); append=true fetches the page starting at `start` and appends.
  const runQuery = useCallback(
    async (start: number, append: boolean) => {
      const seq = ++requestSeq;
      if (append) setLoadingMore(true);
      else setLoading(true);
      let q = sb
        .from("dokumen_arsip")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(start, start + pageSize - 1);
      if (search) {
        const term = escapeOr(search);
        q = q.or(
          `judul_dokumen.ilike."%${term}%",kategori.ilike."%${term}%"`
        );
      }
      const { data, count, error } = await q;
      if (seq !== requestSeq) {
        // Superseded by a newer request: release the loading flag this
        // request owned (the newer one manages its own).
        if (append) setLoadingMore(false);
        return;
      }
      if (error) {
        // A failed load-more keeps the accumulated rows and leaves the offset
        // unchanged, so retrying "Muat lagi" re-requests the same page.
        if (!append) {
          setLoadError(true);
          setDokumenList([]);
          setTotalCount(0);
        }
        toast.error("Gagal memuat data. Coba lagi.");
      } else {
        const rows = (data as DokumenArsip[]) ?? [];
        setLoadError(false);
        setDokumenList((prev) => (append ? [...prev, ...rows] : rows));
        setTotalCount(count ?? 0);
        if (append) setOffset(start + rows.length);
      }
      if (append) setLoadingMore(false);
      else setLoading(false);
    },
    [search, pageSize]
  );

  // Fresh fetch: page 0 replaces any accumulated rows and resets the offset
  // (also fires when the debounced search changes).
  const fetchData = useCallback(() => {
    setOffset(0);
    return runQuery(0, false);
  }, [runQuery]);

  // Load-more: append the next page to the accumulated rows.
  const loadMore = useCallback(() => {
    return runQuery(offset, true);
  }, [runQuery, offset]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Clear the pending debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  function onSearchChange(value: string) {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(value), 300);
  }

  function resetForm() {
    setForm(emptyForm);
  }

  async function handleSave() {
    if (!form.judul_dokumen || !form.kategori) {
      toast.error("Judul dan kategori wajib diisi.");
      return;
    }
    setSaving(true);

    try {
      // Mutasi lewat server action: sesi + peran dicek server-side.
      const res = await uploadDokumenAction({
        judul_dokumen: form.judul_dokumen,
        kategori: form.kategori,
        tanggal_berlaku: form.tanggal_berlaku,
        masa_kadaluarsa: form.masa_kadaluarsa,
        link_drive: form.link_drive,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Gagal menyimpan dokumen. Coba lagi.");
        return;
      }
      toast.success("Dokumen berhasil ditambahkan.");
      setDialogOpen(false);
      resetForm();
      fetchData();
    } catch {
      // Transport error (mis. jaringan putus): server action melempar, bukan
      // mengembalikan { ok:false } — tanpa catch user tidak lihat apa pun.
      toast.error("Gagal terhubung ke server. Coba lagi.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Hapus dokumen ini?")) return;

    // Server action: role check server-side.
    try {
      const res = await deleteDokumenAction(id);
      if (!res.ok) {
        toast.error(res.error ?? "Gagal menghapus dokumen. Coba lagi.");
        return;
      }
      toast.success("Dokumen dihapus.");
      fetchData();
    } catch {
      // transport error — action tetap { ok:false } untuk kegagalan aplikatif;
      // tanpa catch user tidak lihat apa pun.
      toast.error("Gagal terhubung ke server. Coba lagi.");
    }
  }

  function isExpired(doc: DokumenArsip): boolean {
    if (!doc.masa_kadaluarsa) return false;
    // Compare DATE STRINGS, matching the dashboard's
    // .lt("masa_kadaluarsa", today) partition: a document is expired only
    // when its expiry date is strictly before today. new Date('YYYY-MM-DD')
    // parses as UTC midnight, so a naive Date comparison flagged the last
    // valid day (or any UTC+7 afternoon) as 'Kadaluarsa' while the
    // dashboard counted the same document as 'Berlaku'.
    return doc.masa_kadaluarsa.slice(0, 10) < localTodayStr();
  }

  const role: UserRole = (user?.role as UserRole) ?? "viewer";
  const canDelete = canAction(role, "delete_doc");
  // dokumen_arsip writes are gated by create_doc, limited to the same
  // privileged set as delete_doc ('admin qc', 'administrator inbionusa').
  // Hide the upload trigger for other roles, whose insert would only fail
  // server-side with a raw RLS error.
  const canUpload = canAction(role, "create_doc");

  return (
    <div className="space-y-6">
      {/* Page header: micro-label + title left, primary action right */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="micro-label">DOKUMEN</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Arsip Dokumen</h1>
          <p className="mt-1 text-[13px] text-muted">
            Kelola dokumen mutu dan sertifikasi.
          </p>
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={(v) => {
            setDialogOpen(v);
            if (!v) resetForm();
          }}
        >
          {canUpload && (
            <DialogTrigger render={<Button><Plus className="size-4" /> Upload Dokumen</Button>} />
          )}

          <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
            <DialogHeader className="gap-1 border-b border-border px-6 py-4 pr-14">
              <p className="micro-label">DOKUMEN</p>
              <DialogTitle className="text-2xl font-semibold tracking-tight">
                Tambah Dokumen
              </DialogTitle>
            </DialogHeader>

            {/* Scrollable body; the footer stays pinned below it. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Judul Dokumen *</label>
                  <Input
                    value={form.judul_dokumen}
                    onChange={(e) =>
                      setForm({ ...form, judul_dokumen: e.target.value })
                    }
                    placeholder="Nama dokumen"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Kategori *</label>
                  <select
                    className={selectClass}
                    value={form.kategori}
                    onChange={(e) =>
                      setForm({ ...form, kategori: e.target.value })
                    }
                  >
                    <option value="">Pilih kategori…</option>
                    {kategoriDocList.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Tanggal Berlaku</label>
                    <Input
                      type="date"
                      value={form.tanggal_berlaku}
                      onChange={(e) =>
                        setForm({ ...form, tanggal_berlaku: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Masa Kadaluarsa</label>
                    <Input
                      type="date"
                      value={form.masa_kadaluarsa}
                      onChange={(e) =>
                        setForm({ ...form, masa_kadaluarsa: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Link Drive</label>
                  <Input
                    value={form.link_drive}
                    onChange={(e) =>
                      setForm({ ...form, link_drive: e.target.value })
                    }
                    placeholder="https://drive.google.com/..."
                  />
                </div>
              </div>
            </div>

            <DialogFooter className="m-0 flex-row items-center justify-between gap-2 rounded-b-lg px-6 py-4 sm:justify-between">
              <DialogClose render={<Button variant="outline">Batal</Button>} />
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Menyimpan…" : "Tambah"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Toolbar: search left, result meta right */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-60 max-w-full">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input
            placeholder="Cari dokumen…"
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8"
          />
        </div>
        <p className="shrink-0 text-[13px] text-muted">
          <span className="font-data text-text">{dokumenList.length}</span> dari{" "}
          <span className="font-data text-text">{totalCount}</span> data
        </p>
      </div>

      {/* Table card: hairline border, radius 8, header micro-labels on surface-alt */}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-surface-alt">
              <TableHead className="pl-4">Dokumen</TableHead>
              <TableHead>Kategori</TableHead>
              <TableHead>Tgl Berlaku</TableHead>
              <TableHead>Masa Kadaluarsa</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-4">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableSkeleton rows={5} cols={6} />}
            {!loading && loadError && (
              <TableRow>
                <TableCell colSpan={6} className="px-4 py-12">
                  <div className="flex items-center justify-center gap-3 text-[13px] text-muted">
                    Gagal memuat data.
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fetchData()}
                    >
                      Coba Lagi
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {!loading && !loadError && dokumenList.length === 0 && (
              <TableRow className="hover:bg-surface">
                <TableCell colSpan={6} className="px-4 py-12">
                  <div className="flex flex-col items-center gap-4 text-center">
                    <div className="flex size-10 items-center justify-center rounded-full border border-border text-faint">
                      <FileSearch className="size-4" />
                    </div>
                    <p className="micro-label">
                      {search ? "TIDAK ADA HASIL" : "TIDAK ADA DOKUMEN"}
                    </p>
                    {!search && canUpload && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDialogOpen(true)}
                      >
                        <Plus className="size-3.5" /> Upload Dokumen
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}
            {dokumenList.map((doc) => {
              const expired = isExpired(doc);
              const link = safeHref(doc.link_drive ?? "");
              return (
                <TableRow key={doc.id}>
                  <TableCell className="pl-4">
                    <div className="font-medium">{doc.judul_dokumen}</div>
                    <div className="font-data text-xs text-muted">
                      {doc.id.slice(0, 8)}...
                    </div>
                  </TableCell>
                  <TableCell className="text-muted">{doc.kategori}</TableCell>
                  <TableCell className="font-data text-muted">
                    {doc.tanggal_berlaku}
                  </TableCell>
                  <TableCell className="font-data text-muted">
                    {doc.masa_kadaluarsa || "—"}
                  </TableCell>
                  <TableCell>
                    <StatusDocBadge expired={expired} />
                  </TableCell>
                  <TableCell className="pr-4">
                    <div className="flex items-center gap-1">
                      {link && (
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-md p-1.5 text-muted outline-none transition-colors duration-150 hover:bg-surface-alt hover:text-text focus-visible:ring-2 focus-visible:ring-primary/30"
                          title="Buka link"
                          aria-label="Buka link dokumen"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      )}
                      {canDelete && (
                        <button
                          className="rounded-md p-1.5 text-danger outline-none transition-colors duration-150 hover:bg-danger-bg focus-visible:ring-2 focus-visible:ring-danger/20"
                          onClick={() => handleDelete(doc.id)}
                          title="Hapus"
                          aria-label="Hapus dokumen"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pagination: load-more + counter (logic unchanged, restyled) */}
      {!loading && !loadError && dokumenList.length > 0 && (
        <div className="space-y-3">
          {dokumenList.length < totalCount && (
            <Button
              variant="outline"
              className="w-full"
              disabled={loadingMore}
              onClick={() => loadMore()}
            >
              {loadingMore
                ? "Memuat…"
                : `Muat lagi (${totalCount - dokumenList.length} tersisa)`}
            </Button>
          )}
          <p className="text-center text-[13px] text-muted">
            Menampilkan <span className="font-data text-text">{dokumenList.length}</span> dari{" "}
            <span className="font-data text-text">{totalCount}</span> data
          </p>
        </div>
      )}
    </div>
  );
}
