"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "../../user-context";
import { canAction } from "@/lib/types";
import type { MasterProduk, SpesifikasiItem, UserRole } from "@/lib/types";
import { toast } from "sonner";
import { Search, Plus, Pencil, Trash2, Eye } from "lucide-react";
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

function StatusBadge({ status }: { status: string }) {
  const isPass = status === "PASS";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
        isPass
          ? "bg-success-bg text-success-dark"
          : "bg-danger-bg text-danger-dark"
      }`}
    >
      {status}
    </span>
  );
}

function evaluateParam(sp: SpesifikasiItem, val: string): "PASS" | "FAIL" {
  if (!val) return "FAIL";
  if (sp.tipe_batas === "TEXT") return "PASS";
  const num = parseFloat(val);
  if (isNaN(num)) return "FAIL";
  const min = sp.nilai_min ? parseFloat(sp.nilai_min) : -Infinity;
  const max = sp.nilai_maks ? parseFloat(sp.nilai_maks) : Infinity;
  if (sp.tipe_batas === "MIN" && num >= min) return "PASS";
  if (sp.tipe_batas === "MAX" && num <= max) return "PASS";
  if (sp.tipe_batas === "RANGE" && num >= min && num <= max) return "PASS";
  return "FAIL";
}

interface UjiForm {
  id_produk: string;
  no_lot: string;
  tgl_sampling: string;
  tgl_uji: string;
  inspector: string;
  catatan: string;
}

const emptyForm: UjiForm = {
  id_produk: "",
  no_lot: "",
  tgl_sampling: new Date().toISOString().split("T")[0],
  tgl_uji: new Date().toISOString().split("T")[0],
  inspector: "",
  catatan: "",
};

export default function InspeksiPage() {
  const { user } = useUser();
  const sb = createClient();

  const [search, setSearch] = useState("");
  const [data, setData] = useState<any[]>([]);
  const [produkList, setProdukList] = useState<MasterProduk[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<any>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<UjiForm>(emptyForm);
  const [spesifikasi, setSpesifikasi] = useState<SpesifikasiItem[]>([]);
  const [hasilValues, setHasilValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    let q = sb
      .from("hasil_uji")
      .select("*, master_produk!inner(kode_produk, nama_produk)")
      .order("created_at", { ascending: false });
    if (search) {
      q = q.or(
        `no_lot.ilike.%${search}%,master_produk.nama_produk.ilike.%${search}%`
      );
    }
    const { data: raw } = await q;
    setData((raw as any[]) ?? []);
    setLoading(false);
  }, [search]);

  const fetchProduk = useCallback(async () => {
    const { data } = await sb
      .from("master_produk")
      .select("*")
      .order("nama_produk");
    setProdukList((data as MasterProduk[]) ?? []);
  }, []);

  const fetchSpesifikasi = useCallback(async (id_produk: string) => {
    if (!id_produk) {
      setSpesifikasi([]);
      return;
    }
    const { data } = await sb
      .from("spesifikasi")
      .select("*")
      .eq("id_produk", id_produk)
      .order("urutan");
    setSpesifikasi((data as SpesifikasiItem[]) ?? []);
    setHasilValues({});
  }, []);

  useEffect(() => {
    fetchData();
    fetchProduk();
  }, [fetchData, fetchProduk]);

  useEffect(() => {
    fetchSpesifikasi(form.id_produk);
  }, [form.id_produk, fetchSpesifikasi]);

  function resetForm() {
    setForm(emptyForm);
    setSpesifikasi([]);
    setHasilValues({});
    setEditingId(null);
  }

  async function openEdit(item: any) {
    setForm({
      id_produk: item.id_produk,
      no_lot: item.no_lot,
      tgl_sampling: item.tgl_sampling,
      tgl_uji: item.tgl_uji,
      inspector: item.inspector,
      catatan: item.catatan ?? "",
    });
    setEditingId(item.id);

    // Load values from hasil_detail
    if (item.hasil_detail) {
      const vals: Record<string, string> = {};
      for (const h of item.hasil_detail) {
        vals[h.p] = h.val;
      }
      setHasilValues(vals);
    }

    // Load spesifikasi for the product
    await fetchSpesifikasi(item.id_produk);
    setDialogOpen(true);
  }

  function openDetail(item: any) {
    setDetailItem(item);
    setDetailOpen(true);
  }

  function computeOverallStatus(): "PASS" | "FAIL" {
    for (const sp of spesifikasi) {
      const val = hasilValues[sp.parameter_uji] ?? "";
      if (evaluateParam(sp, val) === "FAIL") return "FAIL";
    }
    if (spesifikasi.length === 0) return "FAIL";
    return "PASS";
  }

  function buildHasilDetail() {
    return spesifikasi.map((sp) => ({
      p: sp.parameter_uji,
      t: sp.tipe_batas,
      mn: sp.nilai_min ?? "",
      mx: sp.nilai_maks ?? "",
      u: sp.satuan ?? "",
      k: sp.keterangan ?? "",
      val: hasilValues[sp.parameter_uji] ?? "",
      st: evaluateParam(sp, hasilValues[sp.parameter_uji] ?? ""),
    }));
  }

  async function handleSave() {
    if (!form.id_produk || !form.no_lot) {
      toast.error("Produk dan No Lot wajib diisi.");
      return;
    }
    setSaving(true);

    const detail = buildHasilDetail();
    const status = computeOverallStatus();

    const payload = {
      id_produk: form.id_produk,
      no_lot: form.no_lot,
      tgl_sampling: form.tgl_sampling,
      tgl_uji: form.tgl_uji,
      inspector: form.inspector,
      hasil_detail: detail,
      status,
      catatan: form.catatan,
    };

    try {
      if (editingId) {
        const { error } = await sb.from("hasil_uji").update(payload).eq("id", editingId);
        if (error) throw error;
        toast.success("Hasil uji diperbarui.");
      } else {
        const { error } = await sb.from("hasil_uji").insert(payload);
        if (error) throw error;
        toast.success("Hasil uji ditambahkan.");
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
    if (!confirm("Hapus hasil uji ini?")) return;
    const { error } = await sb.from("hasil_uji").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Hasil uji dihapus.");
      fetchData();
    }
  }

  const role: UserRole = (user?.role as UserRole) ?? "viewer";
  const canDelete = canAction(role, "delete_uji");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Inspeksi / Hasil Uji</h1>
          <p className="text-sm text-muted mt-1">
            Kelola data pengujian dan inspeksi produk.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger render={<Button><Plus className="size-4" /> Input Uji Baru</Button>} />
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Hasil Uji" : "Input Hasil Uji Baru"}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Produk *</label>
                  <select
                    className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={form.id_produk}
                    onChange={(e) => setForm({ ...form, id_produk: e.target.value })}
                  >
                    <option value="">Pilih produk…</option>
                    {produkList.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.kode_produk} — {p.nama_produk}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">No Lot *</label>
                  <Input
                    value={form.no_lot}
                    onChange={(e) => setForm({ ...form, no_lot: e.target.value })}
                    placeholder="LOT-001"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Tgl Sampling</label>
                  <Input
                    type="date"
                    value={form.tgl_sampling}
                    onChange={(e) => setForm({ ...form, tgl_sampling: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Tgl Uji</label>
                  <Input
                    type="date"
                    value={form.tgl_uji}
                    onChange={(e) => setForm({ ...form, tgl_uji: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Inspector</label>
                  <Input
                    value={form.inspector}
                    onChange={(e) => setForm({ ...form, inspector: e.target.value })}
                    placeholder="Nama inspector"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium">Catatan</label>
                <textarea
                  className="flex min-h-16 w-full rounded-lg border border-input bg-transparent px-3 py-1.5 text-sm shadow-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  value={form.catatan}
                  onChange={(e) => setForm({ ...form, catatan: e.target.value })}
                  placeholder="Catatan (opsional)"
                />
              </div>

              {/* Dynamic hasil input */}
              {spesifikasi.length > 0 && (
                <div className="border-t border-border pt-4">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted block mb-3">
                    Hasil Pengujian
                  </span>
                  <div className="space-y-2">
                    {spesifikasi.map((sp) => {
                      const val = hasilValues[sp.parameter_uji] ?? "";
                      const res =
                        val !== "" ? evaluateParam(sp, val) : null;
                      return (
                        <div
                          key={sp.id}
                          className="flex items-center gap-3 p-2 rounded border border-border bg-surface-alt"
                        >
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium">
                              {sp.parameter_uji}
                            </span>
                            {sp.tipe_batas !== "TEXT" && (
                              <span className="text-xs text-muted ml-2">
                                ({sp.tipe_batas}: {sp.nilai_min}
                                {sp.tipe_batas === "RANGE" && ` — ${sp.nilai_maks}`}
                                {sp.satuan && ` ${sp.satuan}`})
                              </span>
                            )}
                          </div>
                          <Input
                            className="w-28 h-7 text-sm"
                            placeholder={sp.tipe_batas === "TEXT" ? "Nilai" : "0"}
                            value={val}
                            onChange={(e) =>
                              setHasilValues({
                                ...hasilValues,
                                [sp.parameter_uji]: e.target.value,
                              })
                            }
                          />
                          {res && (
                            <span
                              className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                                res === "PASS"
                                  ? "bg-success-bg text-success-dark"
                                  : "bg-danger-bg text-danger-dark"
                              }`}
                            >
                              {res}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-xs font-medium">Status Final:</span>
                    <StatusBadge status={computeOverallStatus()} />
                  </div>
                </div>
              )}
              {form.id_produk && spesifikasi.length === 0 && (
                <p className="text-xs text-muted">
                  Produk ini belum memiliki spesifikasi pengujian.
                </p>
              )}
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
          placeholder="Cari no lot atau produk…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl bg-surface shadow-card-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-surface-alt">
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">No Lot</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">Produk</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">Tgl Sampling</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">Tgl Uji</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">Inspector</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">Status</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={7} className="px-4 py-8 text-center text-muted">
                  Memuat…
                </TableCell>
              </TableRow>
            )}
            {!loading && data.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="px-4 py-8 text-center text-muted">
                  Tidak ada data inspeksi.
                </TableCell>
              </TableRow>
            )}
            {data.map((row) => (
              <TableRow
                key={row.id}
                className="border-b border-border last:border-0 hover:bg-chip-bg/40 cursor-pointer"
                onClick={() => openDetail(row)}
              >
                <TableCell className="px-4 py-3 font-medium">{row.no_lot}</TableCell>
                <TableCell className="px-4 py-3">
                  {row.master_produk?.nama_produk || "-"}
                </TableCell>
                <TableCell className="px-4 py-3 text-muted">{row.tgl_sampling}</TableCell>
                <TableCell className="px-4 py-3 text-muted">{row.tgl_uji}</TableCell>
                <TableCell className="px-4 py-3">{row.inspector}</TableCell>
                <TableCell className="px-4 py-3">
                  <StatusBadge status={row.status} />
                </TableCell>
                <TableCell className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    <button
                      className="p-1.5 rounded hover:bg-chip-bg text-muted hover:text-text"
                      onClick={() => openDetail(row)}
                      title="Detail"
                    >
                      <Eye className="size-3.5" />
                    </button>
                    <button
                      className="p-1.5 rounded hover:bg-chip-bg text-muted hover:text-text"
                      onClick={() => openEdit(row)}
                      title="Edit"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    {canDelete && (
                      <button
                        className="p-1.5 rounded hover:bg-danger-bg text-danger"
                        onClick={() => handleDelete(row.id)}
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

      {/* Detail dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Detail Hasil Uji</DialogTitle>
          </DialogHeader>
          {detailItem && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <div>
                  <span className="text-xs text-muted">No Lot</span>
                  <p className="font-medium">{detailItem.no_lot}</p>
                </div>
                <div>
                  <span className="text-xs text-muted">Produk</span>
                  <p className="font-medium">
                    {detailItem.master_produk?.nama_produk || "-"}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted">Tgl Sampling</span>
                  <p>{detailItem.tgl_sampling}</p>
                </div>
                <div>
                  <span className="text-xs text-muted">Tgl Uji</span>
                  <p>{detailItem.tgl_uji}</p>
                </div>
                <div>
                  <span className="text-xs text-muted">Inspector</span>
                  <p>{detailItem.inspector}</p>
                </div>
                <div>
                  <span className="text-xs text-muted">Status</span>
                  <p><StatusBadge status={detailItem.status} /></p>
                </div>
              </div>

              {detailItem.catatan && (
                <div>
                  <span className="text-xs text-muted">Catatan</span>
                  <p className="text-sm">{detailItem.catatan}</p>
                </div>
              )}

              {detailItem.hasil_detail?.length > 0 && (
                <div>
                  <span className="text-xs font-semibold text-muted block mb-2">
                    Hasil Detail
                  </span>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-1.5 font-medium text-muted">Parameter</th>
                        <th className="text-left py-1.5 font-medium text-muted">Nilai</th>
                        <th className="text-left py-1.5 font-medium text-muted">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailItem.hasil_detail.map((h: any, i: number) => (
                        <tr key={i} className="border-b border-border last:border-0">
                          <td className="py-1.5">{h.p}</td>
                          <td className="py-1.5">{h.val}</td>
                          <td className="py-1.5">
                            <span className={`font-medium ${h.st === "PASS" ? "text-success-dark" : "text-danger-dark"}`}>{h.st}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Tutup</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}