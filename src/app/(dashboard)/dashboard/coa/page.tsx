"use client";
import { businessDate } from "@/lib/domain/validation";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "../../user-context";
import { canAction } from "@/lib/types";
import type { CoaRow, HasilUjiItem, HasilUjiRow, UserRole } from "@/lib/types";
import { toast } from "sonner";
import {
  issueCoaAction,
  updateCoaAction,
  deleteCoaAction,
} from "@/lib/actions/coa-actions";
import { Search, Plus, Pencil, Trash2, Printer, Eye, FileText } from "lucide-react";
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
  tanggal_rilis: "",
  tanggal_expired: "",
  mfg_date: "",
  tanda_tangan: "Terverifikasi Digital",
};

// Module-level browser client: a single instance instead of one per render.
const sb = createClient();

// Monotonic counter used to ignore stale list-fetch responses.


// Escape a raw search term for a PostgREST .or() ilike filter. The PostgREST
// v12 quoted-value parser strips ONE backslash from EVERY "\X" pair
// unconditionally, and Postgres LIKE then consumes one more level, so each
// special character ships with two spare backslashes:
//   \ -> \\\\  (parser: \\\\ -> \\ ; LIKE: \\ -> literal \)
//   " -> \"    (parser: \" -> " ; keeps the quoted value intact)
//   % -> \\%  (parser: \\% -> \% ; LIKE: \% -> literal %)
//   _ -> \_   (parser: \_ -> \_ ; LIKE: \_ -> literal _)
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

// Native select styled to match the Input kit (hairline border, 36px, 6px
// radius); focus border + ring come from the global input/select rule.
const selectClass =
  "h-9 w-full rounded-md border border-input bg-surface px-2.5 text-sm transition-colors duration-150 outline-none";

// COA status is derived, not stored: a certificate is Berlaku until its expiry
// date passes. ISO dates compare lexicographically; a blank expiry never
// reads as expired. Rendered as the standard semantic dot-chip.
function coaStatusBadge(tanggalExpired: string) {
  const d = new Date();
  const today = [
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join("-");
  const expired = tanggalExpired !== "" && tanggalExpired < today;
  return expired ? (
    <Badge variant="destructive">Kadaluarsa</Badge>
  ) : (
    <Badge>Berlaku</Badge>
  );
}

export default function COAPage() {
  const requestSeq = useRef(0);
  const appending = useRef(false);
  const { user } = useUser();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [coaList, setCoaList] = useState<CoaRow[]>([]);
  const [availableHasil, setAvailableHasil] = useState<HasilUjiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<CoaRow | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<COAForm>(emptyForm);
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
        .from("coa")
        .select("*, master_produk!inner(kode_produk, nama_produk)", {
          count: "exact",
        })
        .order("created_at", { ascending: false }).order("id")
        .range(start, start + pageSize - 1);
      if (search) {
        // Quoted values (via escapeOr): commas/parens stay literal and the
        // escaped %/_ reach Postgres LIKE as literals, not wildcards.
        const term = escapeOr(search);
        q = q.or(
          `no_coa.ilike."%${term}%",product_name.ilike."%${term}%"`
        );
      }
      const { data: raw, count, error } = await q;
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
          setCoaList([]);
          setTotalCount(0);
        }
        toast.error("Gagal memuat data. Coba lagi.");
      } else {
        const rows = (raw as CoaRow[]) ?? [];
        setLoadError(false);
        setCoaList((prev) => (append ? [...prev, ...rows] : rows));
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

  const [availableError, setAvailableError] = useState(false);
  const [availableLoading, setAvailableLoading] = useState(true);
  const availableSeq = useRef(0);
  const fetchAvailableHasil = useCallback(async () => {
    const seq = ++availableSeq.current;
    setAvailableLoading(true);
    setAvailableError(false);
    const rows: HasilUjiRow[] = [];
    for (let start = 0; ; start += 500) {
      const { data, error } = await sb.from("available_hasil_uji")
        .select("id, no_lot, id_produk, hasil_detail, master_produk!inner(kode_produk, nama_produk)")
        .order("created_at", { ascending: false }).order("id").range(start, start + 499);
      if (seq !== availableSeq.current) return;
      if (error) {
        setAvailableError(true); setAvailableHasil([]); setAvailableLoading(false);
        return;
      }
      const batch = (data ?? []) as unknown as HasilUjiRow[];
      rows.push(...batch);
      if (batch.length < 500) break;
    }
    setAvailableHasil(rows); setAvailableLoading(false);
  }, []);

  useEffect(() => {
    const sequence = requestSeq;
    const sources = availableSeq;
    const timer = setTimeout(() => { void fetchData(); void fetchAvailableHasil(); }, 0);
    return () => { clearTimeout(timer); sequence.current++; sources.current++; appending.current = false; };
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
    setForm({ ...emptyForm, tanggal_rilis: businessDate() });
    setEditingId(null);
  }

  async function openEdit(coa: CoaRow) {
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
        // Mutasi lewat server action: sesi + peran dicek server-side.
        const res = await updateCoaAction({
          id: editingId,
          no_coa: form.no_coa,
          tanggal_rilis: form.tanggal_rilis,
          tanggal_expired: form.tanggal_expired,
          mfg_date: form.mfg_date,
          tanda_tangan: form.tanda_tangan,
        });
        if (!res.ok) {
          toast.error(res.error ?? "Gagal menyimpan COA. Coba lagi.");
          return;
        }
        toast.success("COA diperbarui.");
        setDialogOpen(false);
        resetForm();
        fetchData();
      } catch {
        toast.error("Gagal terhubung ke server. Coba lagi.");
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
      // Server action: nomor otomatis + snapshot + foreign key diturunkan
      // dari baris hasil uji DI SERVER; 23505 race di-retry di sana.
      const res = await issueCoaAction({
        id_hasil: form.id_hasil,
        no_coa: form.no_coa,
        tanggal_rilis: form.tanggal_rilis,
        tanggal_expired: form.tanggal_expired,
        mfg_date: form.mfg_date,
        tanda_tangan: form.tanda_tangan,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Gagal menerbitkan COA.");
        return;
      }
      toast.success("COA berhasil diterbitkan.");
      setDialogOpen(false);
      resetForm();
      fetchData();
      fetchAvailableHasil();
    } catch {
      toast.error("Gagal terhubung ke server. Coba lagi.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Hapus COA ini?")) return;

    // Server action: role check server-side.
    try {
      const res = await deleteCoaAction(id);
      if (!res.ok) {
        toast.error(res.error ?? "Gagal menghapus COA. Coba lagi.");
        return;
      }
      toast.success("COA dihapus.");
      fetchData();
      fetchAvailableHasil();
    } catch {
      toast.error("Gagal terhubung ke server. Coba lagi.");
    }
  }

  function handlePrint(coa: CoaRow) {
    const snapshot = coa.hasil_uji_snapshot;
    const items: HasilUjiItem[] = snapshot.items ?? [];
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<html><head><title>COA - ${escapeHtml(coa.no_coa)}</title>
<style>
  @page { margin: 12mm 15mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Inter', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.5;
    color: #0f172a;
    background: #ffffff;
    margin: 0;
    padding: 32px 24px;
  }
  /* Formal document: one centered 720px sheet. Ink on white, hairline rules,
     no shadows, no fills beyond the token tints on the status chips. */
  .doc { width: 720px; margin: 0 auto; }
  .page { display: flex; flex-direction: column; min-height: 100vh; }
  .micro {
    font-size: 7.5pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #5b6b7c;
  }
  .num { font-variant-numeric: tabular-nums; font-weight: 600; letter-spacing: -0.01em; }

  /* Letterhead: logo + company block left, certificate label + number right. */
  .lh {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid #0f172a;
  }
  .lh-left { display: flex; align-items: center; gap: 12px; }
  .lh-logo {
    width: 40px;
    height: 40px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid #e4e8ec;
    border-radius: 8px;
    color: #047857;
    font-size: 11pt;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .lh-name { font-size: 13pt; font-weight: 700; letter-spacing: 0.02em; }
  .lh-sub { font-size: 8pt; color: #5b6b7c; margin-top: 1px; }
  .lh-right { text-align: right; }
  .lh-no { margin-top: 4px; font-size: 12.5pt; }

  /* Two-column meta grid: product identity left, document dates right,
     separated by a vertical hairline. */
  .meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 32px;
    margin: 20px 0 24px;
  }
  .meta-col + .meta-col { border-left: 1px solid #e4e8ec; padding-left: 32px; }
  .m-row + .m-row { margin-top: 10px; }
  .m-val { margin-top: 1px; font-size: 10.5pt; }

  /* Results table: booktabs rules — hairline frame, heavier header rules,
     faint row dividers. Values keep tabular alignment. */
  .tbl { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  .tbl th {
    text-align: left;
    font-size: 7.5pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #5b6b7c;
    padding: 8px 10px;
    border-top: 1px solid #0f172a;
    border-bottom: 1px solid #0f172a;
  }
  .tbl th:nth-child(2), .tbl th:nth-child(3) { width: 21%; }
  .tbl th:nth-child(4) { width: 15%; text-align: center; }
  .tbl td { padding: 9px 10px; border-bottom: 1px solid #edf0f3; vertical-align: top; }
  .tbl td:nth-child(4) { text-align: center; }
  .tbl tbody tr:last-child td { border-bottom: 1px solid #0f172a; }
  .unit { color: #5b6b7c; font-size: 8.5pt; font-weight: 400; margin-left: 3px; }
  .chip {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 8pt;
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .chip-pass { background: #ecfdf5; color: #065f46; }
  .chip-fail { background: #fef2f2; color: #991b1b; }

  /* Signature: document note left, signer block bottom-right with a blank
     tanda tangan space above a hairline. */
  .foot {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 32px;
    margin-top: auto;
    padding-top: 16px;
    border-top: 1px solid #e4e8ec;
  }
  .doc-note { font-size: 8pt; color: #5b6b7c; line-height: 1.6; }
  .sig { text-align: center; min-width: 220px; }
  .sig-space { height: 18mm; }
  .sig-name {
    font-size: 10pt;
    font-weight: 600;
    padding-top: 6px;
    border-top: 1px solid #0f172a;
  }
  .sig-role { margin-top: 2px; }

  @media print {
    body {
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .doc { width: auto; max-width: 100%; }
    .page { page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .lh { page-break-after: avoid; }
    .meta { page-break-after: avoid; }
    .tbl thead { display: table-header-group; }
    .foot { page-break-inside: avoid; }
  }
</style></head><body>
<div class="page">
  <div class="lh">
    <div class="lh-left">
      <div class="lh-logo">INB</div>
      <div>
        <div class="lh-name">INBIONUSA</div>
        <div class="lh-sub">Quality Control System</div>
      </div>
    </div>
    <div class="lh-right">
      <div class="micro">Certificate of Analysis</div>
      <div class="lh-no num">${escapeHtml(coa.no_coa)}</div>
    </div>
  </div>

  <div class="meta">
    <div class="meta-col">
      <div class="m-row">
        <div class="micro">Nama Produk</div>
        <div class="m-val">${escapeHtml(snapshot.produk || "-")}</div>
      </div>
      <div class="m-row">
        <div class="micro">Kode Produk</div>
        <div class="m-val num">${escapeHtml(snapshot.kode_produk || "-")}</div>
      </div>
      <div class="m-row">
        <div class="micro">MFG Date</div>
        <div class="m-val num">${escapeHtml(coa.mfg_date || "-")}</div>
      </div>
    </div>
    <div class="meta-col">
      <div class="m-row">
        <div class="micro">Nomor Lot</div>
        <div class="m-val num">${escapeHtml(coa.no_lot)}</div>
      </div>
      <div class="m-row">
        <div class="micro">Tanggal Rilis</div>
        <div class="m-val num">${escapeHtml(coa.tanggal_rilis)}</div>
      </div>
      <div class="m-row">
        <div class="micro">Tanggal Expired</div>
        <div class="m-val num">${escapeHtml(coa.tanggal_expired)}</div>
      </div>
      <div class="m-row">
        <div class="micro">Tanggal Sampling</div>
        <div class="m-val num">${escapeHtml(snapshot.ts || "-")}</div>
      </div>
      <div class="m-row">
        <div class="micro">Tanggal Uji</div>
        <div class="m-val num">${escapeHtml(snapshot.tu || "-")}</div>
      </div>
    </div>
  </div>

  <table class="tbl">
    <thead>
      <tr>
        <th>Parameter Uji</th>
        <th>Spesifikasi</th>
        <th>Hasil Uji</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${items.map((item) => {
        const specText = item.t === "TEXT" ? "Teks" : item.t === "MIN" ? "≥ " + item.mn : item.t === "MAX" ? "≤ " + item.mx : (item.mn || "-") + " — " + (item.mx || "-");
        return `<tr><td>${escapeHtml(item.p)}</td><td>${escapeHtml(specText)}</td><td class="num">${escapeHtml(item.val || "-")}${item.u ? '<span class="unit">' + escapeHtml(item.u) + "</span>" : ""}</td><td>${item.st === "PASS" ? '<span class="chip chip-pass">PASS</span>' : '<span class="chip chip-fail">FAIL</span>'}</td></tr>`;
      }).join("")}
    </tbody>
  </table>

  <div class="foot">
    <div class="doc-note">
      INBIONUSA — Quality Control System<br/>
      Dokumen ini terverifikasi secara digital
    </div>
    <div class="sig">
      <div class="micro">Diterbitkan Oleh,</div>
      <div class="sig-space"></div>
      <div class="sig-name">${escapeHtml(coa.tanda_tangan_digital || "Terverifikasi Digital")}</div>
      <div class="sig-role micro">Quality Control</div>
    </div>
  </div>
</div>
<script>window.print();<\/script>
</body></html>`);
    w.document.close();
  }

  function openDetail(coa: CoaRow) {
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
    (h) => h.id === form.id_hasil
  );

  return (
    <div className="space-y-6">
      {/* Page header: micro-label + title left, primary action right */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="micro-label">SERTIFIKAT</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">COA</h1>
          <p className="mt-1 text-[13px] text-muted">
            Terbitkan dan kelola sertifikat analisis produk.
          </p>
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={(v) => {
            if (v && !editingId) resetForm();
            setDialogOpen(v);
            if (!v) resetForm();
          }}
        >
          {canIssue && (
            <DialogTrigger render={<Button><Plus className="size-4" /> Terbitkan COA</Button>} />
          )}

          <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
            <DialogHeader className="gap-1 border-b border-border-soft px-6 py-4 pr-14">
              <p className="micro-label">SERTIFIKAT</p>
              <DialogTitle className="text-2xl font-semibold tracking-tight">
                {editingId ? "Edit COA" : "Terbitkan COA Baru"}
              </DialogTitle>
            </DialogHeader>

            {/* Scrollable body; the hairline footer stays pinned below it. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="space-y-5">
                {!editingId && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">
                      Pilih Hasil Uji (PASS)
                    </label>
                    <select
                      className={selectClass}
                      value={form.id_hasil}
                      disabled={!canWrite || availableLoading || availableError}
                      onChange={(e) => {
                        const val = e.target.value;
                        setForm((prev) => ({ ...prev, id_hasil: val }));
                      }}
                    >
                      <option value="">Pilih hasil uji…</option>
                      {availableHasil.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.no_lot} —{" "}
                          {h.master_produk?.nama_produk || ""}
                        </option>
                      ))}
                    </select>
                    {availableError && (<p role="alert">Gagal memuat hasil uji. <button type="button" onClick={() => void fetchAvailableHasil()}>Coba Lagi</button></p>)}
                    {availableLoading && <p>Memuat hasil uji…</p>}
                    {!availableError && !availableLoading && availableHasil.length === 0 && (
                      <p className="text-[13px] text-muted">
                        Tidak ada hasil uji PASS yang tersedia.
                      </p>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
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
                  <div className="space-y-1.5">
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
                  <div className="space-y-1.5">
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
                  <div className="space-y-1.5">
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

                <div className="space-y-1.5">
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
                  <div className="border-t border-border pt-4">
                    <p className="micro-label">Pratinjau Hasil Uji</p>
                    <table className="mt-3 w-full text-xs">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="py-1.5 text-left text-muted">Parameter</th>
                          <th className="py-1.5 text-left text-muted">Nilai</th>
                          <th className="py-1.5 text-left text-muted">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selectedHasil.hasil_detail ?? []).map(
                          (item, i: number) => (
                            <tr key={i} className="border-b border-border-soft last:border-0">
                              <td className="py-1.5">{item.p}</td>
                              <td className="font-data py-1.5">{item.val}</td>
                              <td className="py-1.5 font-medium text-success-dark">
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
            </div>

            <DialogFooter className="m-0 flex-row items-center justify-between gap-2 rounded-b-lg px-6 py-4 sm:justify-between">
              <DialogClose render={<Button variant="outline">Batal</Button>} />
              {canWrite && (
                <Button onClick={handleSave} disabled={saving || (!editingId && (availableLoading || availableError))}>
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

      {/* Toolbar: search left, result meta right */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-60 max-w-full">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input
            placeholder="Cari COA atau produk…"
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8"
          />
        </div>
        <p className="shrink-0 text-[13px] text-muted">
          <span className="font-data text-text">{coaList.length}</span> dari{" "}
          <span className="font-data text-text">{totalCount}</span> data
        </p>
      </div>

      {/* Table card: hairline border, radius 8, header micro-labels on surface-alt */}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-surface-alt">
              <TableHead className="pl-4">No COA</TableHead>
              <TableHead>Produk</TableHead>
              <TableHead>No Lot</TableHead>
              <TableHead className="text-right">Tgl Rilis</TableHead>
              <TableHead className="text-right">Tgl Expired</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-4">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableSkeleton rows={5} cols={7} />}
            {!loading && loadError && (
              <TableRow>
                <TableCell colSpan={7} className="px-4 py-12">
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
            {!loading && !loadError && coaList.length === 0 && (
              <TableRow className="hover:bg-surface">
                <TableCell colSpan={7} className="px-4 py-12">
                  <div className="flex flex-col items-center gap-4 text-center">
                    <div className="flex size-10 items-center justify-center rounded-full border border-border text-faint">
                      <FileText className="size-4" />
                    </div>
                    <p className="micro-label">
                      {search ? "TIDAK ADA HASIL" : "TIDAK ADA COA"}
                    </p>
                    {!search && canIssue && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { resetForm(); setDialogOpen(true); }}
                      >
                        <Plus className="size-3.5" /> Terbitkan COA
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}
            {coaList.map((coa) => (
              <TableRow key={coa.id}>
                <TableCell className="pl-4 font-data">
                  {coa.no_coa}
                </TableCell>
                <TableCell>
                  <div className="font-medium">
                    {coa.hasil_uji_snapshot?.produk || "-"}
                  </div>
                  <div className="font-data text-xs text-muted">
                    {coa.hasil_uji_snapshot?.kode_produk || "-"}
                  </div>
                </TableCell>
                <TableCell className="font-data text-muted">
                  {coa.no_lot}
                </TableCell>
                <TableCell className="font-data text-muted text-right">
                  {coa.tanggal_rilis}
                </TableCell>
                <TableCell className="font-data text-muted text-right">
                  {coa.tanggal_expired}
                </TableCell>
                <TableCell>{coaStatusBadge(coa.tanggal_expired)}</TableCell>
                <TableCell className="pr-4">
                  <div className="flex items-center gap-1">
                    <button
                      className="rounded-md p-1.5 text-muted outline-none transition-colors duration-150 hover:bg-surface-alt hover:text-text focus-visible:ring-2 focus-visible:ring-primary/30"
                      onClick={() => openDetail(coa)}
                      title="Detail"
                    >
                      <Eye className="size-3.5" />
                    </button>
                    {canEdit && (
                      <button
                        className="rounded-md p-1.5 text-muted outline-none transition-colors duration-150 hover:bg-surface-alt hover:text-text focus-visible:ring-2 focus-visible:ring-primary/30"
                        onClick={() => openEdit(coa)}
                        title="Edit"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                    <button
                      className="rounded-md p-1.5 text-muted outline-none transition-colors duration-150 hover:bg-surface-alt hover:text-text focus-visible:ring-2 focus-visible:ring-primary/30"
                      onClick={() => handlePrint(coa)}
                      title="Cetak"
                    >
                      <Printer className="size-3.5" />
                    </button>
                    {canDelete && (
                      <button
                        className="rounded-md p-1.5 text-danger outline-none transition-colors duration-150 hover:bg-danger-bg focus-visible:ring-2 focus-visible:ring-danger/20"
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

      {/* Pagination: load-more + counter (logic unchanged, restyled) */}
      {!loading && !loadError && coaList.length > 0 && (
        <div className="space-y-3">
          {coaList.length < totalCount && (
            <Button
              variant="outline"
              className="w-full"
              disabled={loadingMore}
              onClick={() => loadMore()}
            >
              {loadingMore
                ? "Memuat…"
                : `Muat lagi (${totalCount - coaList.length} tersisa)`}
            </Button>
          )}
          <p className="text-center text-[13px] text-muted">
            Menampilkan <span className="font-data text-text">{coaList.length}</span> dari{" "}
            <span className="font-data text-text">{totalCount}</span> data
          </p>
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="gap-1 border-b border-border-soft px-6 py-4 pr-14">
            <p className="micro-label">SERTIFIKAT</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">
              Detail COA
            </DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {detailItem && (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div>
                    <p className="micro-label">No COA</p>
                    <p className="font-data mt-0.5 text-sm">{detailItem.no_coa}</p>
                  </div>
                  <div>
                    <p className="micro-label">Produk</p>
                    <p className="mt-0.5 text-sm font-medium">
                      {detailItem.hasil_uji_snapshot?.produk || "-"}
                    </p>
                  </div>
                  <div>
                    <p className="micro-label">No Lot</p>
                    <p className="font-data mt-0.5 text-sm">{detailItem.no_lot}</p>
                  </div>
                  <div>
                    <p className="micro-label">Status</p>
                    <p className="mt-0.5">{coaStatusBadge(detailItem.tanggal_expired)}</p>
                  </div>
                  <div>
                    <p className="micro-label">Tgl Rilis</p>
                    <p className="font-data mt-0.5 text-sm">{detailItem.tanggal_rilis}</p>
                  </div>
                  <div>
                    <p className="micro-label">Tgl Expired</p>
                    <p className="font-data mt-0.5 text-sm">{detailItem.tanggal_expired}</p>
                  </div>
                  {detailItem.mfg_date && (
                    <div>
                      <p className="micro-label">MFG Date</p>
                      <p className="font-data mt-0.5 text-sm">{detailItem.mfg_date}</p>
                    </div>
                  )}
                  <div>
                    <p className="micro-label">Tanda Tangan</p>
                    <p className="mt-0.5 text-sm">{detailItem.tanda_tangan_digital}</p>
                  </div>
                </div>

                {detailItem.hasil_uji_snapshot?.items?.length > 0 && (
                  <div className="border-t border-border pt-4">
                    <p className="micro-label">Hasil Uji</p>
                    <table className="mt-3 w-full text-xs">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="py-1.5 text-left text-muted">Parameter</th>
                          <th className="py-1.5 text-left text-muted">Nilai</th>
                          <th className="py-1.5 text-left text-muted">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailItem.hasil_uji_snapshot.items.map(
                          (item, i: number) => (
                            <tr key={i} className="border-b border-border-soft last:border-0">
                              <td className="py-1.5">{item.p}</td>
                              <td className="font-data py-1.5">{item.val}</td>
                              <td className="py-1.5">
                                <Badge
                                  variant={item.st === "PASS" ? "default" : "destructive"}
                                >
                                  {item.st}
                                </Badge>
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
          </div>

          <DialogFooter className="m-0 flex-row items-center justify-end gap-2 rounded-b-lg px-6 py-4 sm:justify-end">
            <DialogClose render={<Button variant="outline">Tutup</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
