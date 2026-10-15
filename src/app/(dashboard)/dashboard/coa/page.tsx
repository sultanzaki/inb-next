"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "../../user-context";
import { canAction } from "@/lib/types";
import type { UserRole } from "@/lib/types";
import { toast } from "sonner";
import { Search, Plus, Pencil, Trash2, Printer, Eye } from "lucide-react";
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
import { TableSkeleton } from "@/components/table-skeleton";
import { escapeHtml } from "@/lib/format";

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

// Module-level browser client: a single instance instead of one per render.
const sb = createClient();

// Monotonic counter used to ignore stale list-fetch responses.
let requestSeq = 0;

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

// Next COA number derived from SERVER data, not the client list: the rendered
// list is search-filtered, so its length says nothing about the real
// sequence, and two concurrent issuers counting client-side would pick the
// same number and collide on the unique constraint.
async function nextNoCOA(): Promise<string> {
  const year = new Date().getFullYear();
  const { data, error } = await sb
    .from("coa")
    .select("no_coa")
    .order("no_coa", { ascending: false })
    .limit(1);
  // A failed max-lookup must not fall through to seq 0001: that would burn
  // insert retries against the real max with a misleading "No COA sudah
  // digunakan" toast — surface the real error to the caller's catch instead.
  if (error) throw error;
  const last = (data as { no_coa: string }[] | null)?.[0]?.no_coa ?? "";
  const m = last.match(/(\d+)$/);
  const seq = (m ? parseInt(m[1], 10) : 0) + 1;
  return `COA/IBN/${year}/${seq.toString().padStart(4, "0")}`;
}

async function logAudit(
  sb: ReturnType<typeof createClient>,
  user_name: string,
  aksi: string,
  referensi: string
) {
  try {
    await sb.from("audit_log").insert({
      waktu: new Date().toISOString(),
      user_name,
      aksi,
      referensi,
    });
  } catch {
    // silent — audit failure should not block the user
  }
}

export default function COAPage() {
  const { user } = useUser();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [coaList, setCoaList] = useState<any[]>([]);
  const [availableHasil, setAvailableHasil] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<any>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<COAForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    const seq = ++requestSeq;
    setLoading(true);
    let q = sb
      .from("coa")
      .select("*, master_produk!inner(kode_produk, nama_produk)")
      .order("created_at", { ascending: false });
    if (search) {
      // Quoted values (via escapeOr): commas/parens stay literal and the
      // escaped %/_ reach Postgres LIKE as literals, not wildcards.
      const term = escapeOr(search);
      q = q.or(
        `no_coa.ilike."%${term}%",master_produk.nama_produk.ilike."%${term}%"`
      );
    }
    const { data: raw, error } = await q;
    if (seq !== requestSeq) return; // superseded by a newer request
    if (error) {
      setCoaList([]);
      setLoadError(true);
      toast.error("Gagal memuat data. Coba lagi.");
    } else {
      setLoadError(false);
      setCoaList((raw as any[]) ?? []);
    }
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
    setEditingId(null);
  }

  async function openEdit(coa: any) {
    setForm({
      id_hasil: "",
      no_coa: coa.no_coa,
      tanggal_rilis: coa.tanggal_rilis,
      tanggal_expired: coa.tanggal_expired,
      mfg_date: coa.mfg_date ?? "",
      tanda_tangan: coa.tanda_tangan_digital ?? "",
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
        await logAudit(sb, user?.nama_lengkap || user?.username || "system", `update_coa: ${form.no_coa}`, editingId);

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

      const snapshot = {
        produk: selected.master_produk?.nama_produk || "",
        ts: selected.tgl_sampling,
        tu: selected.tgl_uji,
        items: selected.hasil_detail ?? [],
      };

      // Collision-safe numbering: the number comes from the server-side max
      // (not the search-filtered client list), and a 23505 unique violation —
      // a concurrent issuer won the race for that number — is retried with a
      // freshly generated one. A user-typed number is never regenerated: its
      // collision is a duplicate of the user's own choosing, so it surfaces
      // as an error instead.
      const userNo = form.no_coa;
      let no_coa = userNo || (await nextNoCOA());
      for (let attempt = 1; ; attempt++) {
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
        if (!error) break;
        if (error.code === "23505" && !userNo && attempt < 3) {
          no_coa = await nextNoCOA();
          continue;
        }
        throw error;
      }

      toast.success("COA berhasil diterbitkan.");
      await logAudit(sb, user?.nama_lengkap || user?.username || "system", `terbit_coa: ${no_coa}`, `hasil_uji:${selected.id}`);

      setDialogOpen(false);
      resetForm();
      fetchData();
      fetchAvailableHasil();
    } catch (err: any) {
      toast.error(
        err?.code === "23505"
          ? "No COA sudah digunakan. Gunakan nomor lain."
          : err.message || "Gagal menerbitkan COA."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Hapus COA ini?")) return;
    const target = coaList.find((c: any) => c.id === id);
    const { error } = await sb.from("coa").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("COA dihapus.");
      await logAudit(sb, user?.nama_lengkap || user?.username || "system", `delete_coa: ${target?.no_coa || id}`, id);
      fetchData();
      fetchAvailableHasil();
    }
  }

  function handlePrint(coa: any) {
    const snapshot = coa.hasil_uji_snapshot || {};
    const items = snapshot.items || [];
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<html><head><title>COA - ${escapeHtml(coa.no_coa)}</title>
<style>
  @page { margin: 12mm 15mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 11pt;
    color: #111;
    margin: 0;
    padding: 0;
  }
  .coa-page {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .coa-head {
    text-align: center;
    border-bottom: 2px solid #047857;
    padding-bottom: 6mm;
    margin-bottom: 6mm;
  }
  .coa-head h1 {
    font-size: 18pt;
    font-weight: bold;
    color: #064e3b;
    margin: 0 0 2mm;
  }
  .coa-head p {
    font-size: 10pt;
    color: #555;
    margin: 0;
  }
  .coa-title {
    font-size: 14pt;
    font-weight: bold;
    text-align: center;
    margin: 4mm 0 6mm;
    text-transform: uppercase;
    letter-spacing: 1pt;
  }
  .coa-rule {
    border: none;
    border-top: 1px solid #ccc;
    margin: 4mm 0;
  }
  .coa-meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2mm 8mm;
    font-size: 10.5pt;
    margin-bottom: 6mm;
  }
  .coa-meta strong {
    display: inline-block;
    min-width: 50mm;
  }
  .coa-tbl {
    width: 100%;
    border-collapse: collapse;
    font-size: 10.5pt;
    margin-bottom: 6mm;
  }
  .coa-tbl th {
    background: #047857;
    color: #fff;
    font-weight: 600;
    text-align: left;
    padding: 3mm 4mm;
    font-size: 10pt;
  }
  .coa-tbl th:nth-child(3) { width: 19%; text-align: center; }
  .coa-tbl td {
    padding: 2.5mm 4mm;
    border-bottom: 1px solid #ddd;
  }
  .coa-tbl td:nth-child(3) { text-align: center; }
  .coa-tbl tr:last-child td { border-bottom: none; }
  .coa-spacer { flex: 1; }
  .coa-foot {
    display: flex;
    justify-content: space-between;
    font-size: 9.5pt;
    padding-top: 8mm;
    border-top: 1px solid #ccc;
    margin-top: auto;
  }
  .coa-foot .ttd { text-align: right; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .coa-page { page-break-after: always; }
    .coa-page:last-child { page-break-after: auto; }
    .coa-head { page-break-after: avoid; }
    .coa-title, .coa-rule, .coa-meta { page-break-after: avoid; }
    .coa-tbl thead { display: table-header-group; }
  }
</style></head><body>
<div class="coa-page">
  <div class="coa-head">
    <h1>INBIONUSA</h1>
    <p>Quality Control System</p>
  </div>
  <div class="coa-title">Certificate of Analysis</div>
  <hr class="coa-rule" />
  <div class="coa-meta">
    <div><strong>Nomor COA:</strong> ${escapeHtml(coa.no_coa)}</div>
    <div><strong>Tanggal Rilis:</strong> ${escapeHtml(coa.tanggal_rilis)}</div>
    <div><strong>Nama Produk:</strong> ${escapeHtml(coa.master_produk?.nama_produk || "")}</div>
    <div><strong>Tanggal Expired:</strong> ${escapeHtml(coa.tanggal_expired)}</div>
    <div><strong>Nomor Lot:</strong> ${escapeHtml(coa.no_lot)}</div>
    <div><strong>MFG Date:</strong> ${escapeHtml(coa.mfg_date || "-")}</div>
    <div><strong>Tanggal Sampling:</strong> ${escapeHtml(snapshot.ts || "-")}</div>
    <div><strong>Tanggal Uji:</strong> ${escapeHtml(snapshot.tu || "-")}</div>
  </div>
  <table class="coa-tbl">
    <thead>
      <tr>
        <th>Parameter Uji</th>
        <th>Spesifikasi</th>
        <th>Hasil Uji</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${items.map((item: any) => {
        const specText = item.t === "TEXT" ? "Teks" : item.t === "MIN" ? "> " + item.mn : item.t === "MAX" ? "< " + item.mx : (item.mn || "-") + " — " + (item.mx || "-");
        return `<tr><td>${escapeHtml(item.p)}</td><td>${escapeHtml(specText)}</td><td>${escapeHtml(item.val || "-")}</td><td>${item.st === "PASS" ? "✓ PASS" : "✗ FAIL"}</td></tr>`;
      }).join("")}
    </tbody>
  </table>
  <div class="coa-spacer"></div>
  <div class="coa-foot">
    <div class="info">
      INBIONUSA — Quality Control System<br/>
      Dokumen ini terverifikasi secara digital
    </div>
    <div class="ttd">
      <strong>Tanda Tangan Digital</strong><br/>
      ${escapeHtml(coa.tanda_tangan_digital || "Terverifikasi Digital")}
    </div>
  </div>
</div>
<script>window.print();<\/script>
</body></html>`);
    w.document.close();
  }

  function openDetail(coa: any) {
    setDetailItem(coa);
    setDetailOpen(true);
  }

  const role: UserRole = (user?.role as UserRole) ?? "viewer";
  const canDelete = canAction(role, "delete_coa");
  const canIssue = canAction(role, "issue_coa");
  const canEdit = canAction(role, "update_coa");
  // The dialog exists in the tree for every role (so Edit never dead-ends);
  // without a write role every input in it renders disabled (read-only mode).
  const canWrite = canIssue || canEdit;

  // Determine selected hasil details for the preview
  const selectedHasil = availableHasil.find(
    (h: any) => h.id === form.id_hasil
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Certificate of Analysis</h1>
          <p className="text-sm text-muted mt-1">
            Terbitkan dan kelola COA produk.
          </p>
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={(v) => {
            setDialogOpen(v);
            if (!v) resetForm();
          }}
        >
          {canIssue && (
            <DialogTrigger render={<Button><Plus className="size-4" /> Terbitkan COA</Button>} />
          )}
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
                      className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      value={form.id_hasil}
                      disabled={!canWrite}
                      onChange={(e) => {
                        const val = e.target.value;
                        // One functional update; the async prefill below is
                        // guarded so a stale resolution never overwrites a
                        // newer selection or a manually typed number.
                        setForm((prev) => ({ ...prev, id_hasil: val }));
                        // Prefill from the server-side max, not the
                        // (search-filtered) client list length.
                        if (val && !form.no_coa) {
                          nextNoCOA()
                            .then((no) => {
                              setForm((prev) =>
                                prev.id_hasil === val && !prev.no_coa
                                  ? { ...prev, no_coa: no }
                                  : prev
                              );
                            })
                            .catch((err) => {
                              // Prefill is best-effort: leaving the field
                              // empty is fine (save regenerates the number
                              // from the server-side max). Warn only — no
                              // toast-spam on a background prefill.
                              console.warn(
                                "Prefill No COA gagal:",
                                err?.message || err
                              );
                            });
                        }
                      }}
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
                      <p className="text-xs text-muted">
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
                      disabled={!canWrite}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, no_coa: e.target.value }))
                      }
                      placeholder="Otomatis jika dikosongkan"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Tgl Rilis</label>
                    <Input
                      type="date"
                      value={form.tanggal_rilis}
                      disabled={!canWrite}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, tanggal_rilis: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Tgl Expired</label>
                    <Input
                      type="date"
                      value={form.tanggal_expired}
                      disabled={!canWrite}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, tanggal_expired: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">MFG Date</label>
                    <Input
                      type="date"
                      value={form.mfg_date}
                      disabled={!canWrite}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, mfg_date: e.target.value }))
                      }
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium">Tanda Tangan Digital</label>
                  <Input
                    value={form.tanda_tangan}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, tanda_tangan: e.target.value }))
                    }
                    placeholder="Terverifikasi Digital"
                  />
                </div>

                {!editingId && selectedHasil && (
                  <div className="border-t border-border pt-3">
                    <span className="text-xs font-semibold text-muted block mb-2">
                      Pratinjau Hasil Uji
                    </span>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-1 font-medium text-muted">Parameter</th>
                          <th className="text-left py-1 font-medium text-muted">Nilai</th>
                          <th className="text-left py-1 font-medium text-muted">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selectedHasil.hasil_detail ?? []).map(
                          (item: any, i: number) => (
                            <tr key={i} className="border-b border-border last:border-0">
                              <td className="py-1">{item.p}</td>
                              <td className="py-1">{item.val}</td>
                              <td className="py-1 font-medium text-success-dark">
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
                {canWrite && (
                  <Button onClick={handleSave} disabled={saving}>
                    {saving
                      ? "Menyimpan…"
                      : editingId
                      ? "Simpan"
                      : "Terbitkan"}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted pointer-events-none" />
        <Input
          placeholder="Cari COA atau produk…"
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
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">No COA</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">Produk</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">No Lot</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">Tgl Rilis</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-faint px-4 py-3">Tgl Expired</TableHead>
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
            {!loading && !loadError && coaList.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="px-4 py-8 text-center text-muted">
                  Belum ada COA.
                </TableCell>
              </TableRow>
            )}
            {coaList.map((coa) => (
              <TableRow
                key={coa.id}
                className="border-b border-border last:border-0 hover:bg-chip-bg/40"
              >
                <TableCell className="px-4 py-3 font-medium">{coa.no_coa}</TableCell>
                <TableCell className="px-4 py-3">
                  {coa.master_produk?.nama_produk || "-"}
                </TableCell>
                <TableCell className="px-4 py-3 text-muted">
                  {coa.no_lot}
                </TableCell>
                <TableCell className="px-4 py-3 text-muted">
                  {coa.tanggal_rilis}
                </TableCell>
                <TableCell className="px-4 py-3 text-muted">
                  {coa.tanggal_expired}
                </TableCell>
                <TableCell className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button
                      className="p-1.5 rounded hover:bg-chip-bg text-muted hover:text-text"
                      onClick={() => openDetail(coa)}
                      title="Detail"
                    >
                      <Eye className="size-3.5" />
                    </button>
                    {canEdit && (
                      <button
                        className="p-1.5 rounded hover:bg-chip-bg text-muted hover:text-text"
                        onClick={() => openEdit(coa)}
                        title="Edit"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                    <button
                      className="p-1.5 rounded hover:bg-chip-bg text-muted hover:text-text"
                      onClick={() => handlePrint(coa)}
                      title="Cetak"
                    >
                      <Printer className="size-3.5" />
                    </button>
                    {canDelete && (
                      <button
                        className="p-1.5 rounded hover:bg-danger-bg text-danger"
                        onClick={() => handleDelete(coa.id)}
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
            <DialogTitle>Detail COA</DialogTitle>
          </DialogHeader>
          {detailItem && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <div>
                  <span className="text-xs text-muted">No COA</span>
                  <p className="font-medium">{detailItem.no_coa}</p>
                </div>
                <div>
                  <span className="text-xs text-muted">Produk</span>
                  <p className="font-medium">
                    {detailItem.master_produk?.nama_produk || "-"}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted">No Lot</span>
                  <p>{detailItem.no_lot}</p>
                </div>
                <div>
                  <span className="text-xs text-muted">Tgl Rilis</span>
                  <p>{detailItem.tanggal_rilis}</p>
                </div>
                <div>
                  <span className="text-xs text-muted">Tgl Expired</span>
                  <p>{detailItem.tanggal_expired}</p>
                </div>
                {detailItem.mfg_date && (
                  <div>
                    <span className="text-xs text-muted">MFG Date</span>
                    <p>{detailItem.mfg_date}</p>
                  </div>
                )}
              </div>

              <div>
                <span className="text-xs text-muted">Tanda Tangan</span>
                <p className="text-sm">{detailItem.tanda_tangan_digital}</p>
              </div>

              {detailItem.hasil_uji_snapshot?.items?.length > 0 && (
                <div>
                  <span className="text-xs font-semibold text-muted block mb-2">
                    Hasil Uji
                  </span>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-1 font-medium text-muted">Parameter</th>
                        <th className="text-left py-1 font-medium text-muted">Nilai</th>
                        <th className="text-left py-1 font-medium text-muted">Status</th>
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