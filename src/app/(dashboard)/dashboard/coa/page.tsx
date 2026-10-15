"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "../../user-context";
import { canAction } from "@/lib/types";
import type { COA, HasilUji, MasterProduk, UserRole } from "@/lib/types";
import { toast } from "sonner";
import { Search, Plus, Pencil, Trash2, Printer, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

interface COAForm {
  id_hasil: string;
  no_coa: string;
  tanggal_rilis: string;
  tanggal_expired: string;
  mfg_date: string;
  tanda_tangan: string;
}

const emptyForm: COAForm = {
  id_hasil: "",
  no_coa: "",
  tanggal_rilis: new Date().toISOString().split("T")[0],
  tanggal_expired: "",
  mfg_date: "",
  tanda_tangan: "Terverifikasi Digital",
};

export default function COAPage() {
  const { user } = useUser();
  const sb = createClient();

  const [search, setSearch] = useState("");
  const [coaList, setCoaList] = useState<any[]>([]);
  const [availableHasil, setAvailableHasil] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<any>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<COAForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    let q = sb
      .from("coa")
      .select("*, master_produk!inner(kode_produk, nama_produk)")
      .order("created_at", { ascending: false });
    if (search) {
      q = q.or(
        `no_coa.ilike.%${search}%,master_produk.nama_produk.ilike.%${search}%`
      );
    }
    const { data } = await q;
    setCoaList((data as any[]) ?? []);
    setLoading(false);
  }, [search]);

  const fetchAvailableHasil = useCallback(async () => {
    // Get all hasil_uji with PASS status that don't have COA yet
    const { data: coaIds } = await sb.from("coa").select("id_produk, no_lot");
    const existing = new Set(
      (coaIds ?? []).map((c: any) => `${c.id_produk}::${c.no_lot}`)
    );

    const { data: hasil } = await sb
      .from("hasil_uji")
      .select("*, master_produk!inner(kode_produk, nama_produk)")
      .eq("status", "PASS")
      .order("created_at", { ascending: false });

    const filtered = (hasil ?? []).filter(
      (h: any) => !existing.has(`${h.id_produk}::${h.no_lot}`)
    );
    setAvailableHasil(filtered);
  }, []);

  useEffect(() => {
    fetchData();
    fetchAvailableHasil();
  }, [fetchData, fetchAvailableHasil]);

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  async function openEdit(coa: any) {
    setForm({
      id_hasil: "",
      no_coa: coa.no_coa,
      tanggal_rilis: coa.tanggal_rilis,
      tanggal_expired: coa.tanggal_expired,
      mfg_date: coa.mfg_date ?? "",
      tanda_tangan: coa.tanda_tangan_digital,
    });
    setEditingId(coa.id);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (editingId) {
      if (!form.no_coa) {
        toast.error("No COA wajib diisi.");
        return;
      }
      setSaving(true);
      try {
        const { error } = await sb
          .from("coa")
          .update({
            no_coa: form.no_coa,
            tanggal_rilis: form.tanggal_rilis,
            tanggal_expired: form.tanggal_expired,
            mfg_date: form.mfg_date,
            tanda_tangan_digital: form.tanda_tangan,
          })
          .eq("id", editingId);
        if (error) throw error;
        toast.success("COA diperbarui.");
        setDialogOpen(false);
        resetForm();
        fetchData();
      } catch (err: any) {
        toast.error(err.message || "Gagal menyimpan.");
      } finally {
        setSaving(false);
      }
      return;
    }

    // Create new COA from hasil_uji
    if (!form.id_hasil) {
      toast.error("Pilih hasil uji.");
      return;
    }
    setSaving(true);

    try {
      const selected = availableHasil.find(
        (h: any) => h.id === form.id_hasil
      );
      if (!selected) throw new Error("Hasil uji tidak ditemukan.");

      // Auto-generate COA number if empty
      const no_coa = form.no_coa || `COA-${Date.now()}`;

      const snapshot = {
        produk: selected.master_produk?.nama_produk || "",
        ts: selected.tgl_sampling,
        tu: selected.tgl_uji,
        items: selected.hasil_detail ?? [],
      };

      const { error } = await sb.from("coa").insert({
        no_coa,
        id_produk: selected.id_produk,
        no_lot: selected.no_lot,
        tanggal_rilis: form.tanggal_rilis,
        tanggal_expired: form.tanggal_expired,
        hasil_uji_snapshot: snapshot,
        tanda_tangan_digital: form.tanda_tangan,
        mfg_date: form.mfg_date,
      });
      if (error) throw error;

      toast.success("COA berhasil diterbitkan.");
      setDialogOpen(false);
      resetForm();
      fetchData();
      fetchAvailableHasil();
    } catch (err: any) {
      toast.error(err.message || "Gagal menerbitkan COA.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Hapus COA ini?")) return;
    const { error } = await sb.from("coa").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("COA dihapus.");
      fetchData();
      fetchAvailableHasil();
    }
  }

  function handlePrint(coa: any) {
    // Open a print-friendly view
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`
      <html><head><title>COA - ${coa.no_coa}</title>
      <style>
        body { font-family: system-ui, sans-serif; padding: 40px; max-width: 700px; margin: auto; }
        h1 { font-size: 20px; margin-bottom: 4px; }
        .meta { color: #555; font-size: 13px; margin-bottom: 24px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { text-align: left; padding: 8px 8px; border-bottom: 1px solid #ddd; }
        th { background: #f1f5f9; font-weight: 600; }
        .footer { margin-top: 40px; font-size: 12px; color: #888; border-top: 1px solid #ddd; padding-top: 16px; }
        .ttd { margin-top: 32px; font-size: 13px; }
      </style></head><body>
      <h1>CERTIFICATE OF ANALYSIS</h1>
      <div class="meta">
        <p><strong>No COA:</strong> ${coa.no_coa}</p>
        <p><strong>Produk:</strong> ${coa.master_produk?.nama_produk || ""}</p>
        <p><strong>No Lot:</strong> ${coa.no_lot}</p>
        <p><strong>Tanggal Rilis:</strong> ${coa.tanggal_rilis}</p>
        <p><strong>Tanggal Expired:</strong> ${coa.tanggal_expired}</p>
        ${coa.mfg_date ? `<p><strong>MFG Date:</strong> ${coa.mfg_date}</p>` : ""}
      </div>
      <table>
        <tr><th>Parameter</th><th>Nilai</th><th>Status</th></tr>
        ${(coa.hasil_uji_snapshot?.items || [])
          .map(
            (item: any) =>
              `<tr><td>${item.p}</td><td>${item.val}</td><td>${item.st}</td></tr>`
          )
          .join("")}
      </table>
      <div class="ttd">
        <p><strong>Tanda Tangan:</strong> ${coa.tanda_tangan_digital}</p>
      </div>
      <div class="footer">INBIONUSA — Quality Control System</div>
      <script>window.print();<\/script>
      </body></html>
    `);
    w.document.close();
  }

  function openDetail(coa: any) {
    setDetailItem(coa);
    setDetailOpen(true);
  }

  const role: UserRole = (user?.role as UserRole) ?? "viewer";
  const canDelete = canAction(role, "delete_coa");
  const canIssue = canAction(role, "issue_coa");

  // Determine selected hasil details for the preview
  const selectedHasil = availableHasil.find(
    (h: any) => h.id === form.id_hasil
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Certificate of Analysis</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Terbitkan dan kelola COA produk.
          </p>
        </div>
        {canIssue && (
          <Dialog
            open={dialogOpen}
            onOpenChange={(v) => {
              setDialogOpen(v);
              if (!v) resetForm();
            }}
          >
            <DialogTrigger render={<Button><Plus className="size-4" /> Terbitkan COA</Button>} />
            <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingId ? "Edit COA" : "Terbitkan COA Baru"}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                {!editingId && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium">
                      Pilih Hasil Uji (PASS)
                    </label>
                    <select
                      className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      value={form.id_hasil}
                      onChange={(e) => setForm({ ...form, id_hasil: e.target.value })}
                    >
                      <option value="">Pilih hasil uji…</option>
                      {availableHasil.map((h: any) => (
                        <option key={h.id} value={h.id}>
                          {h.no_lot} —{" "}
                          {h.master_produk?.nama_produk || ""}
                        </option>
                      ))}
                    </select>
                    {availableHasil.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Tidak ada hasil uji PASS yang tersedia.
                      </p>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium">No COA</label>
                    <Input
                      value={form.no_coa}
                      onChange={(e) =>
                        setForm({ ...form, no_coa: e.target.value })
                      }
                      placeholder="Otomatis jika dikosongkan"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Tgl Rilis</label>
                    <Input
                      type="date"
                      value={form.tanggal_rilis}
                      onChange={(e) =>
                        setForm({ ...form, tanggal_rilis: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Tgl Expired</label>
                    <Input
                      type="date"
                      value={form.tanggal_expired}
                      onChange={(e) =>
                        setForm({ ...form, tanggal_expired: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">MFG Date</label>
                    <Input
                      type="date"
                      value={form.mfg_date}
                      onChange={(e) =>
                        setForm({ ...form, mfg_date: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium">Tanda Tangan Digital</label>
                  <Input
                    value={form.tanda_tangan}
                    onChange={(e) =>
                      setForm({ ...form, tanda_tangan: e.target.value })
                    }
                    placeholder="Terverifikasi Digital"
                  />
                </div>

                {!editingId && selectedHasil && (
                  <div className="border-t pt-3">
                    <span className="text-xs font-semibold text-muted-foreground block mb-2">
                      Pratinjau Hasil Uji
                    </span>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-1 font-medium">Parameter</th>
                          <th className="text-left py-1 font-medium">Nilai</th>
                          <th className="text-left py-1 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selectedHasil.hasil_detail ?? []).map(
                          (item: any, i: number) => (
                            <tr key={i} className="border-b border-border last:border-0">
                              <td className="py-1">{item.p}</td>
                              <td className="py-1">{item.val}</td>
                              <td className="py-1 font-medium text-emerald-700">
                                {item.st}
                              </td>
                            </tr>
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <DialogFooter>
                <DialogClose render={<Button variant="outline">Batal</Button>} />
                <Button onClick={handleSave} disabled={saving}>
                  {saving
                    ? "Menyimpan…"
                    : editingId
                    ? "Simpan"
                    : "Terbitkan"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Search */}
      <div className="search-wrap max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Cari COA atau produk…"
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
                <th className="text-left px-4 py-3 font-medium">No COA</th>
                <th className="text-left px-4 py-3 font-medium">Produk</th>
                <th className="text-left px-4 py-3 font-medium">No Lot</th>
                <th className="text-left px-4 py-3 font-medium">Tgl Rilis</th>
                <th className="text-left px-4 py-3 font-medium">Tgl Expired</th>
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
              {!loading && coaList.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    Belum ada COA.
                  </td>
                </tr>
              )}
              {coaList.map((coa) => (
                <tr
                  key={coa.id}
                  className="border-b border-border last:border-0 hover:bg-muted/30"
                >
                  <td className="px-4 py-3 font-medium">{coa.no_coa}</td>
                  <td className="px-4 py-3">
                    {coa.master_produk?.nama_produk || "-"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {coa.no_lot}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {coa.tanggal_rilis}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {coa.tanggal_expired}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        onClick={() => openDetail(coa)}
                        title="Detail"
                      >
                        <Eye className="size-3.5" />
                      </button>
                      <button
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        onClick={() => openEdit(coa)}
                        title="Edit"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        onClick={() => handlePrint(coa)}
                        title="Cetak"
                      >
                        <Printer className="size-3.5" />
                      </button>
                      {canDelete && (
                        <button
                          className="p-1.5 rounded hover:bg-red-50 text-red-500"
                          onClick={() => handleDelete(coa.id)}
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

      {/* Detail dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Detail COA</DialogTitle>
          </DialogHeader>
          {detailItem && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground">No COA</span>
                  <p className="font-medium">{detailItem.no_coa}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Produk</span>
                  <p className="font-medium">
                    {detailItem.master_produk?.nama_produk || "-"}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">No Lot</span>
                  <p>{detailItem.no_lot}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Tgl Rilis</span>
                  <p>{detailItem.tanggal_rilis}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Tgl Expired</span>
                  <p>{detailItem.tanggal_expired}</p>
                </div>
                {detailItem.mfg_date && (
                  <div>
                    <span className="text-xs text-muted-foreground">MFG Date</span>
                    <p>{detailItem.mfg_date}</p>
                  </div>
                )}
              </div>

              <div>
                <span className="text-xs text-muted-foreground">Tanda Tangan</span>
                <p className="text-sm">{detailItem.tanda_tangan_digital}</p>
              </div>

              {detailItem.hasil_uji_snapshot?.items?.length > 0 && (
                <div>
                  <span className="text-xs font-semibold text-muted-foreground block mb-2">
                    Hasil Uji
                  </span>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-1 font-medium">Parameter</th>
                        <th className="text-left py-1 font-medium">Nilai</th>
                        <th className="text-left py-1 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailItem.hasil_uji_snapshot.items.map(
                        (item: any, i: number) => (
                          <tr key={i} className="border-b border-border last:border-0">
                            <td className="py-1">{item.p}</td>
                            <td className="py-1">{item.val}</td>
                            <td className="py-1 font-medium">
                              {item.st}
                            </td>
                          </tr>
                        )
                      )}
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
