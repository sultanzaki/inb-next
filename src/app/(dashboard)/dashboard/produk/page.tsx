"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "../../user-context";
import { canAction } from "@/lib/types";
import type { MasterProduk, UserRole } from "@/lib/types";
import { toast } from "sonner";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
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
let requestSeq = 0;

function friendlyDbError(
  err: { message?: string; code?: string } | null | undefined
): string {
  const msg: string = err?.message ?? "";
  const code: string = err?.code ?? "";
  if (code === "23503" || /foreign key/i.test(msg))
    return "Gagal menghapus: produk masih dipakai oleh data lain.";
  if (code === "42501" || /row-level security|permission denied/i.test(msg))
    return "Gagal menghapus: Anda tidak memiliki izin untuk aksi ini.";
  return "Gagal menghapus produk. Coba lagi.";
}

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

function statusHalalBadge(val: string) {
  if (val === "Halal")
    return (
      <Badge variant="outline" className="bg-success-bg text-success-dark border-success-bg">
        {val}
      </Badge>
    );
  return (
    <Badge variant="outline" className="bg-danger-bg text-danger-dark border-danger-bg">
      {val}
    </Badge>
  );
}

export default function ProdukPage() {
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

  const fetchData = useCallback(async () => {
    const seq = ++requestSeq;
    setLoading(true);
    let q = sb.from("master_produk").select("*").order("nama_produk");
    if (search) {
      // Quoted values (via escapeOrTerm): commas/parens stay literal and the
      // escaped %/_ reach Postgres LIKE as literals, not wildcards.
      const term = escapeOrTerm(search);
      q = q.or(
        `nama_produk.ilike."%${term}%",kode_produk.ilike."%${term}%"`
      );
    }
    const { data, error } = await q;
    if (seq !== requestSeq) return; // superseded by a newer request
    if (error) {
      setLoadError(true);
      setProdukList([]);
      toast.error("Gagal memuat data. Coba lagi.");
    } else {
      setLoadError(false);
      setProdukList((data as MasterProduk[]) ?? []);
    }
    setLoading(false);
  }, [search]);

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
    setSpesifikasi([]);
    setEditingId(null);
  }

  async function openEdit(produk: MasterProduk) {
    // Load spesifikasi first: if it fails, don't open the edit dialog at all
    // (saving from a dialog with an empty spec list would wipe real rows).
    const { data: sp, error: spErr } = await sb
      .from("spesifikasi")
      .select("*")
      .eq("id_produk", produk.id)
      .order("urutan");
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
      (sp ?? []).map((s: any) => ({
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
      if (editingId) {
        const { error: e1 } = await sb
          .from("master_produk")
          .update({
            kode_produk: form.kode_produk,
            nama_produk: form.nama_produk,
            kategori: form.kategori,
            satuan: form.satuan,
            status_halal: form.status_halal,
            tipe_kemasan: form.tipe_kemasan,
          })
          .eq("id", editingId);
        if (e1) throw e1;

        // Reversible spec save: snapshot the existing rows BEFORE deleting, so
        // a failed insert can restore the old set instead of losing it forever.
        const { data: oldSpecs, error: snapErr } = await sb
          .from("spesifikasi")
          .select("*")
          .eq("id_produk", editingId);
        if (snapErr) throw snapErr;

        const { error: delErr } = await sb
          .from("spesifikasi")
          .delete()
          .eq("id_produk", editingId);
        if (delErr) throw delErr;

        if (spesifikasi.length > 0) {
          const { error: e2 } = await sb.from("spesifikasi").insert(
            spesifikasi.map((s, i) => ({
              id_produk: editingId,
              ...s,
              urutan: i,
            }))
          );
          if (e2) {
            // Rollback: restore the snapshot rows (best effort).
            const snap = oldSpecs ?? [];
            if (snap.length > 0) {
              const { error: rbErr } = await sb
                .from("spesifikasi")
                .insert(snap);
              if (rbErr) {
                console.error("Gagal memulihkan spesifikasi lama:", rbErr);
              }
            }
            toast.error(
              "Gagal menyimpan spesifikasi. Spesifikasi lama telah dipulihkan."
            );
            return;
          }
        }
        toast.success("Produk berhasil diperbarui.");
      } else {
        const { data: inserted, error: e1 } = await sb
          .from("master_produk")
          .insert({
            kode_produk: form.kode_produk,
            nama_produk: form.nama_produk,
            kategori: form.kategori,
            satuan: form.satuan,
            status_halal: form.status_halal,
            tipe_kemasan: form.tipe_kemasan,
          })
          .select()
          .single();
        if (e1) throw e1;

        if (spesifikasi.length > 0 && inserted) {
          const { error: e2 } = await sb.from("spesifikasi").insert(
            spesifikasi.map((s, i) => ({
              id_produk: inserted.id,
              ...s,
              urutan: i,
            }))
          );
          if (e2) throw e2;
        }
        toast.success("Produk berhasil ditambahkan.");
      }

      setDialogOpen(false);
      resetForm();
      fetchData();
    } catch (err: any) {
      toast.error(err.message || "Gagal menyimpan.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Hapus produk ini? Semua spesifikasi juga akan dihapus.")) return;

    // Pre-check COA references: deleting the product would leave orphan COA
    // rows that vanish from the COA list while the dashboard still counts them.
    const { count: coaCount, error: coaErr } = await sb
      .from("coa")
      .select("id", { count: "exact", head: true })
      .eq("id_produk", id);
    if (coaErr) {
      toast.error("Gagal memuat data. Coba lagi.");
      return;
    }
    if ((coaCount ?? 0) > 0) {
      toast.error("Produk masih punya COA. Hapus COA-nya dulu.");
      return;
    }

    // Check no hasil_uji references this product
    const { data: existingUji, error: ujiErr } = await sb
      .from("hasil_uji")
      .select("id")
      .eq("id_produk", id)
      .limit(1);
    if (ujiErr) {
      toast.error("Gagal memuat data. Coba lagi.");
      return;
    }
    if (existingUji && existingUji.length > 0) {
      toast.error("Produk tidak dapat dihapus karena masih memiliki hasil uji.");
      return;
    }

    const { error } = await sb.from("master_produk").delete().eq("id", id);
    if (error) {
      toast.error(friendlyDbError(error));
    } else {
      toast.success("Produk dihapus.");
      fetchData();
    }
  }

  const role: UserRole = (user?.role as UserRole) ?? "viewer";
  const canDelete = canAction(role, "delete_produk");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Master Produk</h1>
          <p className="text-sm text-muted mt-1">
            Kelola daftar produk dan spesifikasi pengujian.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger render={<Button><Plus className="size-4" /> Produk Baru</Button>} />
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit Produk" : "Tambah Produk Baru"}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              {/* Produk fields */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Kode Produk *</label>
                  <Input
                    value={form.kode_produk}
                    onChange={(e) => setForm({ ...form, kode_produk: e.target.value })}
                    placeholder="PRD-001"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Nama Produk *</label>
                  <Input
                    value={form.nama_produk}
                    onChange={(e) => setForm({ ...form, nama_produk: e.target.value })}
                    placeholder="Nama produk"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Kategori</label>
                  <select
                    className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={form.kategori}
                    onChange={(e) => setForm({ ...form, kategori: e.target.value })}
                  >
                    <option value="">Pilih…</option>
                    {kategoriList.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Satuan</label>
                  <select
                    className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={form.satuan}
                    onChange={(e) => setForm({ ...form, satuan: e.target.value })}
                  >
                    <option value="">Pilih…</option>
                    {satuanList.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Status Halal</label>
                  <select
                    className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={form.status_halal}
                    onChange={(e) => setForm({ ...form, status_halal: e.target.value })}
                  >
                    <option value="Halal">Halal</option>
                    <option value="Non-Halal">Non-Halal</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Tipe Kemasan</label>
                  <select
                    className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
              <div className="border-t border-border pt-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Spesifikasi Pengujian
                  </span>
                  <Button variant="outline" size="sm" onClick={addSpesifikasiRow}>
                    <Plus className="size-3" /> Tambah Parameter
                  </Button>
                </div>

                {spesifikasi.length === 0 && (
                  <p className="text-xs text-muted py-2">
                    Belum ada parameter. Klik &ldquo;Tambah Parameter&rdquo; untuk menambahkan.
                  </p>
                )}

                <div className="space-y-2">
                  {spesifikasi.map((sp, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 p-3 rounded-lg border border-border bg-surface-alt"
                    >
                      <div className="flex-1 grid grid-cols-6 gap-2">
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
                            className="flex h-8 w-full rounded-lg border border-input bg-white px-2 text-xs shadow-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
                        className="mt-5 p-1 rounded hover:bg-danger-bg text-danger"
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

            <DialogFooter>
              <DialogClose render={<Button variant="outline">Batal</Button>} />
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Menyimpan…" : editingId ? "Simpan" : "Tambah"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted pointer-events-none" />
        <Input
          placeholder="Cari produk…"
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl bg-surface shadow-card-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-surface-alt">
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">Produk</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">Kategori</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">Satuan</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">Halal</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">Kemasan</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableSkeleton rows={5} cols={6} />}
            {!loading && loadError && (
              <TableRow>
                <TableCell colSpan={6} className="px-4 py-8">
                  <div className="flex items-center justify-center gap-3 text-muted">
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
              <TableRow>
                <TableCell colSpan={6} className="px-4 py-8 text-center text-muted">
                  Tidak ada produk.
                </TableCell>
              </TableRow>
            )}
            {produkList.map((p) => (
              <TableRow key={p.id} className="border-b border-border last:border-0 hover:bg-chip-bg/40">
                <TableCell className="px-4 py-3">
                  <div className="font-medium">{p.nama_produk}</div>
                  <div className="text-xs text-muted">{p.kode_produk}</div>
                </TableCell>
                <TableCell className="px-4 py-3 text-muted">{p.kategori}</TableCell>
                <TableCell className="px-4 py-3">{p.satuan}</TableCell>
                <TableCell className="px-4 py-3">{statusHalalBadge(p.status_halal)}</TableCell>
                <TableCell className="px-4 py-3 text-muted">{p.tipe_kemasan}</TableCell>
                <TableCell className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button
                      className="p-1.5 rounded hover:bg-chip-bg text-muted hover:text-text"
                      onClick={() => openEdit(p)}
                      title="Edit"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    {canDelete && (
                      <button
                        className="p-1.5 rounded hover:bg-danger-bg text-danger"
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
    </div>
  );
}
