"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "../../user-context";
import { canAction } from "@/lib/types";
import type { DokumenArsip, UserRole } from "@/lib/types";
import { toast } from "sonner";
import { Search, Plus, Trash2, ExternalLink, Upload } from "lucide-react";
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
  tanggal_berlaku: new Date().toISOString().split("T")[0],
  masa_kadaluarsa: "",
  link_drive: "",
};

export default function DokumenPage() {
  const { user } = useUser();
  const sb = createClient();

  const [search, setSearch] = useState("");
  const [dokumenList, setDokumenList] = useState<DokumenArsip[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<DocForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    let q = sb.from("dokumen_arsip").select("*").order("created_at", { ascending: false });
    if (search) {
      q = q.or(
        `judul_dokumen.ilike.%${search}%,kategori.ilike.%${search}%`
      );
    }
    const { data } = await q;
    setDokumenList((data as DokumenArsip[]) ?? []);
    setLoading(false);
  }, [search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
      const { error } = await sb.from("dokumen_arsip").insert({
        judul_dokumen: form.judul_dokumen,
        kategori: form.kategori,
        tanggal_berlaku: form.tanggal_berlaku,
        masa_kadaluarsa: form.masa_kadaluarsa,
        link_drive: form.link_drive,
        file_url: "",
      });
      if (error) throw error;

      toast.success("Dokumen berhasil ditambahkan.");
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
    if (!confirm("Hapus dokumen ini?")) return;
    const { error } = await sb.from("dokumen_arsip").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Dokumen dihapus.");
      fetchData();
    }
  }

  function isExpired(doc: DokumenArsip): boolean {
    if (!doc.masa_kadaluarsa) return false;
    return new Date(doc.masa_kadaluarsa) < new Date();
  }

  const role: UserRole = (user?.role as UserRole) ?? "viewer";
  const canDelete = canAction(role, "delete_doc");

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Arsip Dokumen</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
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
          <DialogTrigger render={<Button><Plus className="size-4" /> Upload Dokumen</Button>} />
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Tambah Dokumen</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium">Judul Dokumen *</label>
                <Input
                  value={form.judul_dokumen}
                  onChange={(e) =>
                    setForm({ ...form, judul_dokumen: e.target.value })
                  }
                  placeholder="Nama dokumen"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Kategori *</label>
                <select
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Tanggal Berlaku</label>
                  <Input
                    type="date"
                    value={form.tanggal_berlaku}
                    onChange={(e) =>
                      setForm({ ...form, tanggal_berlaku: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
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
              <div className="space-y-1">
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

            <DialogFooter>
              <DialogClose render={<Button variant="outline">Batal</Button>} />
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Menyimpan…" : "Tambah"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="search-wrap max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Cari dokumen…"
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
                <th className="text-left px-4 py-3 font-medium">ID</th>
                <th className="text-left px-4 py-3 font-medium">Judul</th>
                <th className="text-left px-4 py-3 font-medium">Kategori</th>
                <th className="text-left px-4 py-3 font-medium">Tgl Berlaku</th>
                <th className="text-left px-4 py-3 font-medium">Masa Kadaluarsa</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    Memuat…
                  </td>
                </tr>
              )}
              {!loading && dokumenList.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    Tidak ada dokumen.
                  </td>
                </tr>
              )}
              {dokumenList.map((doc) => {
                const expired = isExpired(doc);
                return (
                  <tr
                    key={doc.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                      {doc.id.slice(0, 8)}...
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {doc.judul_dokumen}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="font-normal">
                        {doc.kategori}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {doc.tanggal_berlaku}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {doc.masa_kadaluarsa}
                    </td>
                    <td className="px-4 py-3">
                      {expired ? (
                        <Badge
                          variant="outline"
                          className="bg-red-50 text-red-700 border-red-200"
                        >
                          Kadaluarsa
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="bg-emerald-50 text-emerald-700 border-emerald-200"
                        >
                          Berlaku
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {doc.link_drive && (
                          <a
                            href={doc.link_drive}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                            title="Buka link"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        )}
                        {canDelete && (
                          <button
                            className="p-1.5 rounded hover:bg-red-50 text-red-500"
                            onClick={() => handleDelete(doc.id)}
                            title="Hapus"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
