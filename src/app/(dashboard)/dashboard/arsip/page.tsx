"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "../../user-context";
import { canAction } from "@/lib/types";
import type { DokumenArsip, UserRole } from "@/lib/types";
import { toast } from "sonner";
import { Search, Plus, Trash2, ExternalLink } from "lucide-react";
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

function StatusDocBadge({ expired }: { expired: boolean }) {
  if (expired) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-danger-bg text-danger-dark">
        Kadaluarsa
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-success-bg text-success-dark">
      Berlaku
    </span>
  );
}

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

  const fetchData = useCallback(async () => {
    const seq = ++requestSeq;
    setLoading(true);
    let q = sb.from("dokumen_arsip").select("*").order("created_at", { ascending: false });
    if (search) {
      const term = escapeOr(search);
      q = q.or(
        `judul_dokumen.ilike."%${term}%",kategori.ilike."%${term}%"`
      );
    }
    const { data, error } = await q;
    if (seq !== requestSeq) return; // superseded by a newer request
    if (error) {
      setDokumenList([]);
      setLoadError(true);
      toast.error("Gagal memuat data. Coba lagi.");
    } else {
      setDokumenList((data as DokumenArsip[]) ?? []);
      setLoadError(false);
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
    } catch {
      toast.error("Gagal menyimpan dokumen. Periksa izin Anda dan coba lagi.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Hapus dokumen ini?")) return;
    const { error } = await sb.from("dokumen_arsip").delete().eq("id", id);
    if (error) {
      toast.error("Gagal menghapus dokumen. Periksa izin Anda dan coba lagi.");
    } else {
      toast.success("Dokumen dihapus.");
      fetchData();
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
  // No dedicated create key exists in ROLE_ALLOW; dokumen_arsip writes are
  // limited to the same privileged set as delete_doc ('admin qc',
  // 'administrator inbionusa'). Hide the upload trigger for other roles,
  // whose insert would only fail server-side with a raw RLS error.
  const canUpload = canAction(role, "delete_doc");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Arsip Dokumen</h1>
          <p className="text-sm text-muted mt-1">
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
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted pointer-events-none" />
        <Input
          placeholder="Cari dokumen…"
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
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">ID</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">Judul</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">Kategori</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">Tgl Berlaku</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">Masa Kadaluarsa</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">Status</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableSkeleton rows={5} cols={7} />}
            {!loading && loadError && (
              <TableRow>
                <TableCell colSpan={7} className="px-4 py-8">
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
            {!loading && !loadError && dokumenList.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="px-4 py-8 text-center text-muted">
                  Tidak ada dokumen.
                </TableCell>
              </TableRow>
            )}
            {dokumenList.map((doc) => {
              const expired = isExpired(doc);
              return (
                <TableRow
                  key={doc.id}
                  className="border-b border-border last:border-0 hover:bg-chip-bg/40"
                >
                  <TableCell className="px-4 py-3 text-xs text-muted font-mono">
                    {doc.id.slice(0, 8)}...
                  </TableCell>
                  <TableCell className="px-4 py-3 font-medium">
                    {doc.judul_dokumen}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-chip-bg text-muted">
                      {doc.kategori}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-muted">
                    {doc.tanggal_berlaku}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-muted">
                    {doc.masa_kadaluarsa}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <StatusDocBadge expired={expired} />
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {doc.link_drive && (
                        <a
                          href={doc.link_drive}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded hover:bg-chip-bg text-muted hover:text-text"
                          title="Buka link"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      )}
                      {canDelete && (
                        <button
                          className="p-1.5 rounded hover:bg-danger-bg text-danger"
                          onClick={() => handleDelete(doc.id)}
                          title="Hapus"
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
    </div>
  );
}
