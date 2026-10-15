"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "../../user-context";
import { canAction } from "@/lib/types";
import type { MasterProduk, SpesifikasiItem, UserRole } from "@/lib/types";
import { toast } from "sonner";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

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
      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
        {val}
      </Badge>
    );
  return (
    <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
      {val}
    </Badge>
  );
}

export default function ProdukPage() {
  const { user } = useUser();
  const sb = createClient();

  const [search, setSearch] = useState("");
  const [produkList, setProdukList] = useState<MasterProduk[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProdukForm>(emptyForm);
  const [spesifikasi, setSpesifikasi] = useState<SpesifikasiForm[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    let q = sb.from("master_produk").select("*").order("nama_produk");
    if (search) {
      q = q.or(
        `nama_produk.ilike.%${search}%,kode_produk.ilike.%${search}%`
      );
    }
    const { data } = await q;
    setProdukList((data as MasterProduk[]) ?? []);
    setLoading(false);
  }, [search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function resetForm() {
    setForm(emptyForm);
    setSpesifikasi([]);
    setEditingId(null);
  }

  async function openEdit(produk: MasterProduk) {
    setForm({
      kode_produk: produk.kode_produk,
      nama_produk: produk.nama_produk,
      kategori: produk.kategori,
      satuan: produk.satuan,
      status_halal: produk.status_halal,
      tipe_kemasan: produk.tipe_kemasan,
    });
    setEditingId(produk.id);

    const { data: sp } = await sb
      .from("spesifikasi")
      .select("*")
      .eq("id_produk", produk.id)
      .order("urutan");
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

        // delete old spesifikasi, re-insert
        await sb.from("spesifikasi").delete().eq("id_produk", editingId);
        if (spesifikasi.length > 0) {
          const { error: e2 } = await sb.from("spesifikasi").insert(
            spesifikasi.map((s, i) => ({
              id_produk: editingId,
              ...s,
              urutan: i,
            }))
          );
          if (e2) throw e2;
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
    const { error } = await sb.from("master_produk").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Produk dihapus.");
      fetchData();
    }
  }

  const role: UserRole = (user?.role as UserRole) ?? "viewer";
  const canDelete = canAction(role, "delete_produk");

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Master Produk</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
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
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Spesifikasi Pengujian
                  </span>
                  <Button variant="outline" size="sm" onClick={addSpesifikasiRow}>
                    <Plus className="size-3" /> Tambah Parameter
                  </Button>
                </div>

                {spesifikasi.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">
                    Belum ada parameter. Klik &ldquo;Tambah Parameter&rdquo; untuk menambahkan.
                  </p>
                )}

                <div className="space-y-2">
                  {spesifikasi.map((sp, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 p-3 rounded-lg border bg-muted/30"
                    >
                      <div className="flex-1 grid grid-cols-6 gap-2">
                        <div className="col-span-2 space-y-1">
                          <label className="text-[10px] font-medium text-muted-foreground">Parameter</label>
                          <Input
                            value={sp.parameter_uji}
                            onChange={(e) => updateSpesifikasi(idx, "parameter_uji", e.target.value)}
                            placeholder="Parameter"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-medium text-muted-foreground">Tipe</label>
                          <select
                            className="h-8 w-full rounded-lg border border-input bg-white px-2 text-xs focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
                          <label className="text-[10px] font-medium text-muted-foreground">Min</label>
                          <Input
                            value={sp.nilai_min}
                            onChange={(e) => updateSpesifikasi(idx, "nilai_min", e.target.value)}
                            placeholder="Min"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-medium text-muted-foreground">Maks</label>
                          <Input
                            value={sp.nilai_maks}
                            onChange={(e) => updateSpesifikasi(idx, "nilai_maks", e.target.value)}
                            placeholder="Maks"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-medium text-muted-foreground">Satuan</label>
                          <Input
                            value={sp.satuan}
                            onChange={(e) => updateSpesifikasi(idx, "satuan", e.target.value)}
                            placeholder="Satuan"
                          />
                        </div>
                      </div>
                      <button
                        className="mt-5 p-1 rounded hover:bg-red-50 text-red-500"
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
      <div className="search-wrap max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Cari produk…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <div className="panel">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
                <th className="text-left px-4 py-3 font-medium">Produk</th>
                <th className="text-left px-4 py-3 font-medium">Kategori</th>
                <th className="text-left px-4 py-3 font-medium">Satuan</th>
                <th className="text-left px-4 py-3 font-medium">Halal</th>
                <th className="text-left px-4 py-3 font-medium">Kemasan</th>
                <th className="text-left px-4 py-3 font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    Memuat…
                  </td>
                </tr>
              )}
              {!loading && produkList.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    Tidak ada produk.
                  </td>
                </tr>
              )}
              {produkList.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="font-medium">{p.nama_produk}</div>
                    <div className="text-xs text-muted-foreground">{p.kode_produk}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{p.kategori}</td>
                  <td className="px-4 py-3">{p.satuan}</td>
                  <td className="px-4 py-3">{statusHalalBadge(p.status_halal)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.tipe_kemasan}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        onClick={() => openEdit(p)}
                        title="Edit"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      {canDelete && (
                        <button
                          className="p-1.5 rounded hover:bg-red-50 text-red-500"
                          onClick={() => handleDelete(p.id)}
                          title="Hapus"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
