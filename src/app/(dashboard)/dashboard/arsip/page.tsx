"use client";
import {
  PageHeader,
  DataToolbar,
  DataPagination,
  EmptyState,
  FilterTabs,
} from "@/components/workspace/page-ui";
import { DomainDialog } from "@/components/workspace/domain-dialog";
import { DomainForm, Field } from "@/components/workspace/domain-form";
import { useConfirm } from "@/components/workspace/confirm-provider";
import { documentSchema } from "@/lib/domain/validation";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "../../user-context";
import { canAction } from "@/lib/types";
import type { DokumenArsip, UserRole } from "@/lib/types";
import { toast } from "sonner";
import {
  uploadDokumenAction,
  deleteDokumenAction,
} from "@/lib/actions/arsip-actions";
import { Plus, Trash2, ExternalLink, FileSearch } from "lucide-react";
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
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

// Module-level browser client: a single instance instead of one per render.
const sb = createClient();

// Monotonic counter used to ignore stale list-fetch responses (fast typing
// through the debounced search).

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
  tanggal_berlaku: "",
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
        <span
          className="size-[5px] rounded-full bg-danger"
          aria-hidden="true"
        />
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
  const confirm = useConfirm();
  const [filter, setFilter] = useState("all");
  const [order, setOrder] = useState("default");
  const requestSeq = useRef(0);
  const appending = useRef(false);
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
      if (append && appending.current) return;
      appending.current = append;
      const seq = ++requestSeq.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      let q = sb
        .from("dokumen_arsip")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: order === "oldest" })
        .order("id")
        .range(start, start + pageSize - 1);
      if (filter === "active") q = q.gte("masa_kadaluarsa", localTodayStr());
      if (filter === "expired") q = q.lt("masa_kadaluarsa", localTodayStr());
      if (search) {
        const term = escapeOr(search);
        q = q.or(`judul_dokumen.ilike."%${term}%",kategori.ilike."%${term}%"`);
      }
      const { data, count, error } = await q;
      if (seq !== requestSeq.current) {
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
        setOffset(start + rows.length);
      }
      appending.current = false;
      setLoadingMore(false);
      setLoading(false);
    },
    [search, pageSize, filter, order],
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
    const sequence = requestSeq;
    const timer = setTimeout(() => {
      void fetchData();
    }, 0);
    return () => {
      clearTimeout(timer);
      sequence.current++;
      appending.current = false;
    };
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
    setForm({ ...emptyForm, tanggal_berlaku: localTodayStr() });
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
    if (
      !(await confirm({
        title: "Hapus dokumen ini?",
        description:
          "Data yang dihapus tidak dapat dipulihkan melalui aplikasi. Pastikan data tidak lagi diperlukan.",
        confirmLabel: "Ya, hapus data",
      }))
    )
      return;

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
    <div className="page-stack">
      <PageHeader
        eyebrow="Dokumen mutu"
        title="Arsip Dokumen"
        description="Dokumen penting, tersimpan rapi. Pantau masa berlaku tanpa kehilangan konteks."
      >
        <DomainDialog
          dirtyValue={form}
          busy={saving}
          open={dialogOpen}
          onOpenChange={(v) => {
            if (v) resetForm();
            setDialogOpen(v);
            if (!v) resetForm();
          }}
        >
          {canUpload && (
            <DialogTrigger
              render={
                <Button>
                  <Plus className="size-4" /> Tambah Dokumen
                </Button>
              }
            />
          )}

          <DialogContent className="flex max-h-[90svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
            <DialogHeader className="gap-1 border-b border-border-soft px-6 py-4 pr-14">
              <p className="micro-label">DOKUMEN</p>
              <DialogTitle className="text-2xl font-semibold tracking-tight">
                Tambah Dokumen
              </DialogTitle>
              <DialogDescription className="mt-2 text-xs leading-relaxed">
                Simpan informasi dokumen dan tautan berkas agar mudah ditemukan
                kembali.
              </DialogDescription>
            </DialogHeader>
            <DomainForm
              value={form}
              schema={documentSchema}
              onSubmit={handleSave}
            >
              {/* Scrollable body; the footer stays pinned below it. */}
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <div className="space-y-4">
                  <Field label="Judul Dokumen *" name="judul_dokumen" required>
                    <Input
                      value={form.judul_dokumen}
                      onChange={(e) =>
                        setForm({ ...form, judul_dokumen: e.target.value })
                      }
                      placeholder="Nama dokumen"
                    />
                  </Field>
                  <Field label="Kategori *" name="kategori" required>
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
                  </Field>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field
                      label="Tanggal Berlaku"
                      name="tanggal_berlaku"
                      required
                    >
                      <Input
                        type="date"
                        value={form.tanggal_berlaku}
                        onChange={(e) =>
                          setForm({ ...form, tanggal_berlaku: e.target.value })
                        }
                      />
                    </Field>
                    <Field
                      label="Masa Kadaluarsa"
                      name="masa_kadaluarsa"
                      required
                    >
                      <Input
                        type="date"
                        value={form.masa_kadaluarsa}
                        onChange={(e) =>
                          setForm({ ...form, masa_kadaluarsa: e.target.value })
                        }
                      />
                    </Field>
                  </div>
                  <Field label="Link Drive" name="link_drive">
                    <Input
                      value={form.link_drive}
                      onChange={(e) =>
                        setForm({ ...form, link_drive: e.target.value })
                      }
                      placeholder="https://drive.google.com/..."
                    />
                  </Field>
                </div>
              </div>

              <DialogFooter className="m-0 flex-row items-center justify-between gap-2 rounded-b-lg px-6 py-4 sm:justify-between">
                <DialogClose
                  render={<Button variant="outline">Batal</Button>}
                />
                <Button type="submit" loading={saving} disabled={saving}>
                  {saving ? "Menyimpan…" : "Tambah"}
                </Button>
              </DialogFooter>
            </DomainForm>
          </DialogContent>
        </DomainDialog>
      </PageHeader>

      <div>
        <FilterTabs
          label="Filter arsip"
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: "Semua dokumen" },
            { value: "active", label: "Berlaku" },
            { value: "expired", label: "Kedaluwarsa" },
          ]}
        />
        <DataToolbar
          search={searchInput}
          onSearch={onSearchChange}
          placeholder="Cari dokumen…"
          total={totalCount}
          loading={loading}
          onRefresh={() => void fetchData()}
          order={order}
          onOrder={setOrder}
        />
      </div>

      {/* Table card: hairline border, radius 8, header micro-labels on surface-alt */}
      <div className="data-card">
        <Table data-actions>
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
                <TableCell colSpan={6} className="!p-0">
                  <EmptyState
                    error
                    title="Data belum berhasil dimuat"
                    description="Koneksi mungkin terputus. Muat ulang untuk mencoba kembali."
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fetchData()}
                    >
                      Coba Lagi
                    </Button>
                  </EmptyState>
                </TableCell>
              </TableRow>
            )}
            {!loading && !loadError && dokumenList.length === 0 && (
              <TableRow className="hover:bg-surface">
                <TableCell colSpan={6} className="!p-0">
                  <div className="empty-state">
                    <div className="empty-icon">
                      <FileSearch className="size-4" />
                    </div>
                    <p className="text-base font-semibold tracking-tight">
                      {search || filter !== "all"
                        ? "Tidak ada hasil yang cocok"
                        : "Belum ada dokumen"}
                    </p>
                    <p className="text-xs text-muted">
                      {search || filter !== "all"
                        ? "Coba kata kunci lain atau hapus pencarian Anda."
                        : "Mulai dengan menambahkan data pertama ke ruang kerja ini."}
                    </p>
                    {!search && filter === "all" && canUpload && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          resetForm();
                          setDialogOpen(true);
                        }}
                      >
                        <Plus className="size-3.5" /> Tambah Dokumen
                      </Button>
                    )}
                    {(search || filter !== "all") && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          onSearchChange("");
                          setFilter("all");
                        }}
                      >
                        Reset filter
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              dokumenList.map((doc) => {
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
                    <TableCell className="font-data text-muted text-right">
                      {doc.tanggal_berlaku}
                    </TableCell>
                    <TableCell className="font-data text-muted text-right">
                      {doc.masa_kadaluarsa || "—"}
                    </TableCell>
                    <TableCell>
                      <StatusDocBadge expired={expired} />
                    </TableCell>
                    <TableCell className="pr-4">
                      <div className="row-actions">
                        {link && (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="row-action"
                            title="Buka link"
                            aria-label="Buka link dokumen"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            className="row-action"
                            data-tone="danger"
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

      {!loading && !loadError && dokumenList.length > 0 && (
        <DataPagination
          count={dokumenList.length}
          total={totalCount}
          loading={loadingMore}
          onMore={() => void loadMore()}
        />
      )}
    </div>
  );
}
