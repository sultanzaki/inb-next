"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "../../user-context";
import { canAction } from "@/lib/types";
import type { MasterProduk, SpesifikasiItem, UserRole } from "@/lib/types";
import { toast } from "sonner";
import { saveProdukAction, deleteProdukAction } from "@/lib/actions/produk-actions";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  PackageSearch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/table-skeleton";
import { escapeOrTerm } from "@/lib/filter-utils";

// Module-level browser client: a single instance instead of one per render.
const sb = createClient();

// Monotonic counter used to ignore stale list-fetch responses.


const kategoriList = [
  "Bahan Baku",
  "Produk Jadi",
  "Bahan Kemas",
  "Bahan Tambahan",
];
const satuanList = ["Kg", "Gram", "Liter", "mL", "Unit", "Botol", "Sachet", "Dos"];
const kemasanList = ["Botol", "Sachet", "Dos", "Jerigen", "Drum", "Pouch", "Lainnya"];

interface SpesifikasiForm {
  parameter_uji: string;
  tipe_batas: "RANGE" | "MIN" | "MAX" | "TEXT";
  nilai_min: string;
  nilai_maks: string;
  satuan: string;
  keterangan: string;
}

interface ProdukForm {
  kode_produk: string;
  nama_produk: string;
  kategori: string;
  satuan: string;
  status_halal: string;
  tipe_kemasan: string;
}

const emptyForm: ProdukForm = {
  kode_produk: "",
  nama_produk: "",
  kategori: "",
  satuan: "",
  status_halal: "Halal",
  tipe_kemasan: "",
};

// Status is always a dot-chip: emerald tint for Halal, danger tint otherwise.
function statusHalalBadge(val: string) {
  if (val === "Halal") return <Badge>Halal</Badge>;
  return <Badge variant="destructive">Non-Halal</Badge>;
}

// Native select styled to match the Input kit (hairline border, 36px, 6px
// radius); focus border + ring come from the global input/select rule.
const selectClass =
  "h-9 w-full rounded-md border border-input bg-surface px-2.5 text-sm transition-colors duration-150 outline-none";

export default function ProdukPage() {
  const requestSeq = useRef(0);
  const editSeq = useRef(0);
  const appending = useRef(false);
  const { user } = useUser();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [produkList, setProdukList] = useState<MasterProduk[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProdukForm>(emptyForm);
  const [spesifikasi, setSpesifikasi] = useState<SpesifikasiForm[]>([]);
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
        .from("master_produk")
        .select("*", { count: "exact" })
        .order("nama_produk").order("id")
        .range(start, start + pageSize - 1);
      if (search) {
        // Quoted values (via escapeOrTerm): commas/parens stay literal and the
        // escaped %/_ reach Postgres LIKE as literals, not wildcards.
        const term = escapeOrTerm(search);
        q = q.or(
          `nama_produk.ilike."%${term}%",kode_produk.ilike."%${term}%"`
        );
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
          setProdukList([]);
          setTotalCount(0);
        }
        toast.error("Gagal memuat data. Coba lagi.");
      } else {
        const rows = (data as MasterProduk[]) ?? [];
        setLoadError(false);
        setProdukList((prev) => (append ? [...prev, ...rows] : rows));
        setTotalCount(count ?? 0);
        setOffset(start + rows.length);
      }
      appending.current = false;
      setLoadingMore(false);
      setLoading(false);
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
    const sequence = requestSeq;
    const timer = setTimeout(() => { void fetchData(); }, 0);
    return () => { clearTimeout(timer); sequence.current++; appending.current = false; };
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
    editSeq.current++;
    setForm(emptyForm);
    setSpesifikasi([]);
    setEditingId(null);
  }

  async function openEdit(produk: MasterProduk) {
    const seq = ++editSeq.current;
    // Load spesifikasi first: if it fails, don't open the edit dialog at all
    // (saving from a dialog with an empty spec list would wipe real rows).
    const { data: sp, error: spErr } = await sb
      .from("spesifikasi")
      .select("*")
      .eq("id_produk", produk.id)
      .order("urutan");
    if (seq !== editSeq.current) return;
    if (spErr) {
      toast.error("Gagal memuat data. Coba lagi.");
      return;
    }

    setForm({
      kode_produk: produk.kode_produk,
      nama_produk: produk.nama_produk,
      kategori: produk.kategori,
      satuan: produk.satuan,
      status_halal: produk.status_halal,
      tipe_kemasan: produk.tipe_kemasan,
    });
    setEditingId(produk.id);

    setSpesifikasi(
      (sp ?? []).map((s: SpesifikasiItem) => ({
        parameter_uji: s.parameter_uji,
        tipe_batas: s.tipe_batas,
        nilai_min: s.nilai_min ?? "",
        nilai_maks: s.nilai_maks ?? "",
        satuan: s.satuan ?? "",
        keterangan: s.keterangan ?? "",
      }))
    );
    setDialogOpen(true);
  }

  function addSpesifikasiRow() {
    setSpesifikasi((prev) => [
      ...prev,
      {
        parameter_uji: "",
        tipe_batas: "RANGE",
        nilai_min: "",
        nilai_maks: "",
        satuan: "",
        keterangan: "",
      },
    ]);
  }

  function updateSpesifikasi(idx: number, field: keyof SpesifikasiForm, value: string) {
    setSpesifikasi((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }

  function removeSpesifikasi(idx: number) {
    setSpesifikasi((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!form.kode_produk || !form.nama_produk) {
      toast.error("Kode dan nama produk wajib diisi.");
      return;
    }
    setSaving(true);
    try {
      // Mutasi lewat server action: sesi + peran dicek server-side.
      const res = await saveProdukAction({ id: editingId, ...form, spesifikasi });
      if (!res.ok) {
        toast.error(res.error ?? "Gagal menyimpan produk. Coba lagi.");
        return;
      }
      toast.success(editingId ? "Produk berhasil diperbarui." : "Produk berhasil ditambahkan.");
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
    if (!confirm("Hapus produk ini? Semua spesifikasi juga akan dihapus.")) return;

    // Server action: pre-check COA/hasil uji + role check server-side.
    try {
      const res = await deleteProdukAction(id);
      if (!res.ok) {
        toast.error(res.error ?? "Gagal menghapus produk. Coba lagi.");
        return;
      }
      toast.success("Produk dihapus.");
      fetchData();
    } catch {
      // transport error — action tetap { ok:false } untuk kegagalan aplikatif;
      // tanpa catch user tidak lihat apa pun.
      toast.error("Gagal terhubung ke server. Coba lagi.");
    }
  }

  const role: UserRole = (user?.role as UserRole) ?? "viewer";
  const canDelete = canAction(role, "delete_produk");
  const canCreate = canAction(role, "create_produk");
  const canUpdate = canAction(role, "update_produk");

  return (
    <div className="space-y-6">
      {/* Page header: micro-label + title left, primary action right */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="micro-label">MASTER DATA</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Master Produk</h1>
          <p className="mt-1 text-[13px] text-muted">
            Kelola daftar produk dan spesifikasi pengujian.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) resetForm(); }}>
          {canCreate && (
            <DialogTrigger render={<Button><Plus className="size-4" /> Produk Baru</Button>} />
          )}

          <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
            <DialogHeader className="gap-1 border-b border-border-soft px-6 py-4 pr-14">
              <p className="micro-label">MASTER DATA</p>
              <DialogTitle className="text-2xl font-semibold tracking-tight">
                {editingId ? "Edit Produk" : "Tambah Produk Baru"}
              </DialogTitle>
            </DialogHeader>

            {/* Scrollable body; the footer stays pinned below it. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="space-y-6">
                {/* Produk fields: two-column grid */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Kode Produk *</label>
                    <Input
                      value={form.kode_produk}
                      onChange={(e) => setForm({ ...form, kode_produk: e.target.value })}
                      placeholder="PRD-001"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Nama Produk *</label>
                    <Input
                      value={form.nama_produk}
                      onChange={(e) => setForm({ ...form, nama_produk: e.target.value })}
                      placeholder="Nama produk"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Kategori</label>
                    <select
                      className={selectClass}
                      value={form.kategori}
                      onChange={(e) => setForm({ ...form, kategori: e.target.value })}
                    >
                      <option value="">Pilih…</option>
                      {kategoriList.map((k) => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Satuan</label>
                    <select
                      className={selectClass}
                      value={form.satuan}
                      onChange={(e) => setForm({ ...form, satuan: e.target.value })}
                    >
                      <option value="">Pilih…</option>
                      {satuanList.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Status Halal</label>
                    <select
                      className={selectClass}
                      value={form.status_halal}
                      onChange={(e) => setForm({ ...form, status_halal: e.target.value })}
                    >
                      <option value="Halal">Halal</option>
                      <option value="Non-Halal">Non-Halal</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Tipe Kemasan</label>
                    <select
                      className={selectClass}
                      value={form.tipe_kemasan}
                      onChange={(e) => setForm({ ...form, tipe_kemasan: e.target.value })}
                    >
                      <option value="">Pilih…</option>
                      {kemasanList.map((k) => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Spesifikasi section */}
                <div className="border-t border-border pt-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <span className="micro-label">Spesifikasi Pengujian</span>
                    <Button variant="outline" size="sm" onClick={addSpesifikasiRow}>
                      <Plus className="size-3.5" /> Tambah Parameter
                    </Button>
                  </div>

                  {spesifikasi.length === 0 && (
                    <p className="text-[13px] text-muted">
                      Belum ada parameter. Klik &ldquo;Tambah Parameter&rdquo; untuk menambahkan.
                    </p>
                  )}

                  <div className="space-y-2">
                    {spesifikasi.map((sp, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-3 rounded-md border border-border bg-surface-alt p-3"
                      >
                        <div className="grid flex-1 grid-cols-6 gap-2">
                          <div className="col-span-2 space-y-1">
                            <label className="text-[10px] font-medium text-muted">Parameter</label>
                            <Input
                              value={sp.parameter_uji}
                              onChange={(e) => updateSpesifikasi(idx, "parameter_uji", e.target.value)}
                              placeholder="Parameter"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-medium text-muted">Tipe</label>
                            <select
                              className="h-8 w-full rounded-md border border-input bg-surface px-2 text-xs transition-colors duration-150 outline-none"
                              value={sp.tipe_batas}
                              onChange={(e) => updateSpesifikasi(idx, "tipe_batas", e.target.value)}
                            >
                              <option value="RANGE">RANGE</option>
                              <option value="MIN">MIN</option>
                              <option value="MAX">MAX</option>
                              <option value="TEXT">TEXT</option>
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-medium text-muted">Min</label>
                            <Input
                              value={sp.nilai_min}
                              onChange={(e) => updateSpesifikasi(idx, "nilai_min", e.target.value)}
                              placeholder="Min"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-medium text-muted">Maks</label>
                            <Input
                              value={sp.nilai_maks}
                              onChange={(e) => updateSpesifikasi(idx, "nilai_maks", e.target.value)}
                              placeholder="Maks"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-medium text-muted">Satuan</label>
                            <Input
                              value={sp.satuan}
                              onChange={(e) => updateSpesifikasi(idx, "satuan", e.target.value)}
                              placeholder="Satuan"
                            />
                          </div>
                        </div>
                        <button
                          className="mt-5 rounded-md p-1 text-danger outline-none transition-colors duration-150 hover:bg-danger-bg focus-visible:ring-2 focus-visible:ring-danger/20"
                          onClick={() => removeSpesifikasi(idx)}
                          title="Hapus"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter className="m-0 flex-row items-center justify-between gap-2 rounded-b-lg px-6 py-4 sm:justify-between">
              <DialogClose render={<Button variant="outline">Batal</Button>} />
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Menyimpan…" : editingId ? "Simpan" : "Tambah"}
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
            placeholder="Cari produk…"
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8"
          />
        </div>
        <p className="shrink-0 text-[13px] text-muted">
          <span className="font-data text-text">{produkList.length}</span> dari{" "}
          <span className="font-data text-text">{totalCount}</span> data
        </p>
      </div>

      {/* Table card: hairline border, radius 8, header micro-labels on surface-alt */}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-surface-alt">
              <TableHead className="pl-4">Produk</TableHead>
              <TableHead>Kategori</TableHead>
              <TableHead>Satuan</TableHead>
              <TableHead>Halal</TableHead>
              <TableHead>Kemasan</TableHead>
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
            {!loading && !loadError && produkList.length === 0 && (
              <TableRow className="hover:bg-surface">
                <TableCell colSpan={6} className="px-4 py-12">
                  <div className="flex flex-col items-center gap-4 text-center">
                    <div className="flex size-10 items-center justify-center rounded-full border border-border text-faint">
                      <PackageSearch className="size-4" />
                    </div>
                    <p className="micro-label">
                      {search ? "TIDAK ADA HASIL" : "TIDAK ADA PRODUK"}
                    </p>
                    {!search && canCreate && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDialogOpen(true)}
                      >
                        <Plus className="size-3.5" /> Produk Baru
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}
            {produkList.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="pl-4">
                  <div className="font-medium">{p.nama_produk}</div>
                  <div className="font-data text-xs text-muted">{p.kode_produk}</div>
                </TableCell>
                <TableCell className="text-muted">{p.kategori}</TableCell>
                <TableCell>{p.satuan}</TableCell>
                <TableCell>{statusHalalBadge(p.status_halal)}</TableCell>
                <TableCell className="text-muted">{p.tipe_kemasan}</TableCell>
                <TableCell className="pr-4">
                  <div className="flex items-center gap-1">
                    {canUpdate && (
                      <button
                        className="rounded-md p-1.5 text-muted outline-none transition-colors duration-150 hover:bg-surface-alt hover:text-text focus-visible:ring-2 focus-visible:ring-primary/30"
                        onClick={() => openEdit(p)}
                        title="Edit"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        className="rounded-md p-1.5 text-danger outline-none transition-colors duration-150 hover:bg-danger-bg focus-visible:ring-2 focus-visible:ring-danger/20"
                        onClick={() => handleDelete(p.id)}
                        title="Hapus"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination: load-more + counter (logic unchanged, restyled) */}
      {!loading && !loadError && produkList.length > 0 && (
        <div className="space-y-3">
          {produkList.length < totalCount && (
            <Button
              variant="outline"
              className="w-full"
              disabled={loadingMore}
              onClick={() => loadMore()}
            >
              {loadingMore
                ? "Memuat…"
                : `Muat lagi (${totalCount - produkList.length} tersisa)`}
            </Button>
          )}
          <p className="text-center text-[13px] text-muted">
            Menampilkan <span className="font-data text-text">{produkList.length}</span> dari{" "}
            <span className="font-data text-text">{totalCount}</span> data
          </p>
        </div>
      )}
    </div>
  );
}
