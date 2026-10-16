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
import { ResultTable } from "@/components/workspace/result-table";
import { useConfirm } from "@/components/workspace/confirm-provider";
import { issueSchema, updateCoaSchema } from "@/lib/domain/validation";

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
import { Plus, Pencil, Trash2, Printer, Eye, FileText } from "lucide-react";
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
  DialogDescription,
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
  tanda_tangan: "",
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
  const today = [d.getFullYear(), d.getMonth() + 1, d.getDate()]
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
  const confirm = useConfirm();
  const [filter, setFilter] = useState("all");
  const [order, setOrder] = useState("default");
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
        .order("created_at", { ascending: order === "oldest" })
        .order("id")
        .range(start, start + pageSize - 1);
      if (filter === "active") q = q.gte("tanggal_expired", businessDate());
      if (filter === "expired") q = q.lt("tanggal_expired", businessDate());
      if (search) {
        // Quoted values (via escapeOr): commas/parens stay literal and the
        // escaped %/_ reach Postgres LIKE as literals, not wildcards.
        const term = escapeOr(search);
        q = q.or(`no_coa.ilike."%${term}%",product_name.ilike."%${term}%"`);
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

  const [availableError, setAvailableError] = useState(false);
  const [availableLoading, setAvailableLoading] = useState(true);
  const availableSeq = useRef(0);
  const fetchAvailableHasil = useCallback(async () => {
    const seq = ++availableSeq.current;
    setAvailableLoading(true);
    setAvailableError(false);
    const rows: HasilUjiRow[] = [];
    for (let start = 0; ; start += 500) {
      const { data, error } = await sb
        .from("available_hasil_uji")
        .select(
          "id, no_lot, id_produk, hasil_detail, master_produk!inner(kode_produk, nama_produk)",
        )
        .order("created_at", { ascending: false })
        .order("id")
        .range(start, start + 499);
      if (seq !== availableSeq.current) return;
      if (error) {
        setAvailableError(true);
        setAvailableHasil([]);
        setAvailableLoading(false);
        return;
      }
      const batch = (data ?? []) as unknown as HasilUjiRow[];
      rows.push(...batch);
      if (batch.length < 500) break;
    }
    setAvailableHasil(rows);
    setAvailableLoading(false);
  }, []);

  useEffect(() => {
    const sequence = requestSeq;
    const sources = availableSeq;
    const timer = setTimeout(() => {
      void fetchData();
      void fetchAvailableHasil();
    }, 0);
    return () => {
      clearTimeout(timer);
      sequence.current++;
      sources.current++;
      appending.current = false;
    };
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
    setForm({
      ...emptyForm,
      tanggal_rilis: businessDate(),
      tanda_tangan: user?.nama_lengkap ?? "",
    });
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
    if (
      !(await confirm({
        title: "Hapus COA ini?",
        description:
          "Data yang dihapus tidak dapat dipulihkan melalui aplikasi. Pastikan data tidak lagi diperlukan.",
        confirmLabel: "Ya, hapus data",
      }))
    )
      return;

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
    if (!w) {
      toast.error("Izinkan jendela pop-up untuk mencetak COA.");
      return;
    }
    w.document
      .write(`<html lang="id"><head><meta charset="utf-8"/><title>COA - ${escapeHtml(coa.no_coa)}</title>
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
  .page { display: flex; flex-direction: column; min-height: 1000px; max-width: 820px; margin: 0 auto; }
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
    border-bottom: 3px solid #047857;
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
    object-fit: contain;
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
    .page { page-break-after: always; min-height: 260mm; max-width: none; margin: 0; }
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
      <img class="lh-logo" src="/logo.png" alt="INBIONUSA" />
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
      ${items
        .map((item) => {
          const specText =
            item.t === "TEXT"
              ? "Teks"
              : item.t === "MIN"
                ? "≥ " + item.mn
                : item.t === "MAX"
                  ? "≤ " + item.mx
                  : (item.mn || "-") + " — " + (item.mx || "-");
          return `<tr><td>${escapeHtml(item.p)}</td><td>${escapeHtml(specText)}</td><td class="num">${escapeHtml(item.val || "-")}${item.u ? '<span class="unit">' + escapeHtml(item.u) + "</span>" : ""}</td><td>${item.st === "PASS" ? '<span class="chip chip-pass">PASS</span>' : '<span class="chip chip-fail">FAIL</span>'}</td></tr>`;
        })
        .join("")}
    </tbody>
  </table>

  <div class="foot">
    <div class="doc-note">
      INBIONUSA — Quality Control System<br/>
      Diterbitkan berdasarkan snapshot hasil pengujian.
    </div>
    <div class="sig">
      <div class="micro">Diterbitkan Oleh,</div>
      <div class="sig-space"></div>
      <div class="sig-name">${escapeHtml(coa.tanda_tangan_digital || "—")}</div>
      <div class="sig-role micro">Quality Control</div>
    </div>
  </div>
</div>
<script>window.addEventListener("load",()=>{window.print()});<\/script>
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
  const selectedHasil = availableHasil.find((h) => h.id === form.id_hasil);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Sertifikasi"
        title="Certificate of Analysis"
        description="Penerbitan dan riwayat Certificate of Analysis."
      >
        <DomainDialog
          dirtyValue={form}
          busy={saving}
          open={dialogOpen}
          onOpenChange={(v) => {
            if (v && !editingId) resetForm();
            setDialogOpen(v);
            if (!v) resetForm();
          }}
        >
          {canIssue && (
            <DialogTrigger
              render={
                <Button>
                  <Plus className="size-4" /> Terbitkan COA
                </Button>
              }
            />
          )}

          <DialogContent className="flex max-h-[90svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
            <DialogHeader className="gap-1 border-b border-border-soft px-6 py-4 pr-14">
              <p className="micro-label">SERTIFIKAT</p>
              <DialogTitle className="text-2xl font-semibold tracking-tight">
                {editingId ? "Edit COA" : "Terbitkan COA Baru"}
              </DialogTitle>
              <DialogDescription className="mt-2 text-xs leading-relaxed">
                Pilih hasil uji yang lulus dan lengkapi informasi penerbitan
                sertifikat.
              </DialogDescription>
            </DialogHeader>
            <DomainForm
              value={{ ...form, id: editingId }}
              schema={editingId ? updateCoaSchema : issueSchema}
              onSubmit={handleSave}
            >
              {/* Scrollable body; the hairline footer stays pinned below it. */}
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <div className="space-y-5">
                  {!editingId && (
                    <div className="space-y-1.5">
                      <Field
                        label="Pilih Hasil Uji (PASS)"
                        name="id_hasil"
                        required
                      >
                        <select
                          className={selectClass}
                          value={form.id_hasil}
                          disabled={
                            !canWrite || availableLoading || availableError
                          }
                          onChange={(e) => {
                            const val = e.target.value;
                            setForm((prev) => ({ ...prev, id_hasil: val }));
                          }}
                        >
                          <option value="">Pilih hasil uji…</option>
                          {availableHasil.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.no_lot} — {h.master_produk?.nama_produk || ""}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {availableError && (
                        <p role="alert">
                          Gagal memuat hasil uji.{" "}
                          <button
                            type="button"
                            onClick={() => void fetchAvailableHasil()}
                          >
                            Coba Lagi
                          </button>
                        </p>
                      )}
                      {availableLoading && <p>Memuat hasil uji…</p>}
                      {!availableError &&
                        !availableLoading &&
                        availableHasil.length === 0 && (
                          <p className="text-[13px] text-muted">
                            Tidak ada hasil uji PASS yang tersedia.
                          </p>
                        )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <Field label="No COA" name="no_coa">
                      <Input
                        value={form.no_coa}
                        disabled={!canWrite}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            no_coa: e.target.value,
                          }))
                        }
                        placeholder="Otomatis jika dikosongkan"
                      />
                    </Field>
                    <Field label="Tgl Rilis" name="tanggal_rilis" required>
                      <Input
                        type="date"
                        value={form.tanggal_rilis}
                        disabled={!canWrite}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            tanggal_rilis: e.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="Tgl Expired" name="tanggal_expired" required>
                      <Input
                        type="date"
                        value={form.tanggal_expired}
                        disabled={!canWrite}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            tanggal_expired: e.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="MFG Date" name="mfg_date">
                      <Input
                        type="date"
                        value={form.mfg_date}
                        disabled={!canWrite}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            mfg_date: e.target.value,
                          }))
                        }
                      />
                    </Field>
                  </div>

                  <Field
                    label="Nama penerbit"
                    hint="Nama penanggung jawab yang ditampilkan pada sertifikat."
                    name="tanda_tangan"
                    required
                  >
                    <Input
                      value={form.tanda_tangan}
                      disabled={!canWrite}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          tanda_tangan: e.target.value,
                        }))
                      }
                      placeholder="Nama penanggung jawab"
                    />
                  </Field>

                  {!editingId && selectedHasil && (
                    <div className="border-t border-border pt-4">
                      <p className="micro-label">Pratinjau Hasil Uji</p>
                      <div className="mt-3">
                        <ResultTable items={selectedHasil.hasil_detail ?? []} />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter className="m-0 flex-row items-center justify-between gap-2 rounded-b-lg px-6 py-4 sm:justify-between">
                <DialogClose
                  render={<Button variant="outline">Batal</Button>}
                />
                {canWrite && (
                  <Button
                    type="submit"
                    loading={saving}
                    disabled={
                      saving ||
                      (!editingId && (availableLoading || availableError))
                    }
                  >
                    {saving ? "Menyimpan…" : editingId ? "Simpan" : "Terbitkan"}
                  </Button>
                )}
              </DialogFooter>
            </DomainForm>
          </DialogContent>
        </DomainDialog>
      </PageHeader>

      <div>
        <FilterTabs
          label="Filter coa"
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: "Semua COA" },
            { value: "active", label: "Berlaku" },
            { value: "expired", label: "Kedaluwarsa" },
          ]}
        />
        <DataToolbar
          search={searchInput}
          onSearch={onSearchChange}
          placeholder="Cari COA atau produk…"
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
                <TableCell colSpan={7} className="!p-0">
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
            {!loading && !loadError && coaList.length === 0 && (
              <TableRow className="hover:bg-surface">
                <TableCell colSpan={7} className="!p-0">
                  <div className="empty-state">
                    <div className="empty-icon">
                      <FileText className="size-4" />
                    </div>
                    <p className="text-base font-semibold tracking-tight">
                      {search || filter !== "all"
                        ? "Tidak ada hasil yang cocok"
                        : "Belum ada sertifikat"}
                    </p>
                    <p className="text-xs text-muted">
                      {search || filter !== "all"
                        ? "Coba kata kunci lain atau hapus pencarian Anda."
                        : "Mulai dengan menambahkan data pertama ke ruang kerja ini."}
                    </p>
                    {!search && filter === "all" && canIssue && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          resetForm();
                          setDialogOpen(true);
                        }}
                      >
                        <Plus className="size-3.5" /> Terbitkan COA
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
              coaList.map((coa) => (
                <TableRow key={coa.id}>
                  <TableCell className="pl-4 font-data">{coa.no_coa}</TableCell>
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
                    <div className="row-actions">
                      <button
                        type="button"
                        className="row-action"
                        onClick={() => openDetail(coa)}
                        title="Detail"
                      >
                        <Eye className="size-3.5" />
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          className="row-action"
                          onClick={() => openEdit(coa)}
                          title="Edit"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        className="row-action"
                        onClick={() => handlePrint(coa)}
                        title="Cetak"
                      >
                        <Printer className="size-3.5" />
                      </button>
                      {canDelete && (
                        <button
                          type="button"
                          className="row-action"
                          data-tone="danger"
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

      {!loading && !loadError && coaList.length > 0 && (
        <DataPagination
          count={coaList.length}
          total={totalCount}
          loading={loadingMore}
          onMore={() => void loadMore()}
        />
      )}

      {/* Detail dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="flex max-h-[90svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="gap-1 border-b border-border-soft px-6 py-4 pr-14">
            <p className="micro-label">SERTIFIKAT</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">
              Detail COA
            </DialogTitle>
            <DialogDescription>
              Snapshot hasil pengujian saat sertifikat diterbitkan.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {detailItem && (
              <div className="space-y-5">
                <div className="detail-metadata grid grid-cols-1 gap-5 rounded-xl border border-border-soft bg-surface-alt p-5 sm:grid-cols-2">
                  <div>
                    <p className="micro-label">No COA</p>
                    <p className="font-data mt-0.5 text-sm">
                      {detailItem.no_coa}
                    </p>
                  </div>
                  <div>
                    <p className="micro-label">Produk</p>
                    <p className="mt-0.5 text-sm font-medium">
                      {detailItem.hasil_uji_snapshot?.produk || "-"}
                    </p>
                  </div>
                  <div>
                    <p className="micro-label">No Lot</p>
                    <p className="font-data mt-0.5 text-sm">
                      {detailItem.no_lot}
                    </p>
                  </div>
                  <div>
                    <p className="micro-label">Status</p>
                    <p className="mt-0.5">
                      {coaStatusBadge(detailItem.tanggal_expired)}
                    </p>
                  </div>
                  <div>
                    <p className="micro-label">Tgl Rilis</p>
                    <p className="font-data mt-0.5 text-sm">
                      {detailItem.tanggal_rilis}
                    </p>
                  </div>
                  <div>
                    <p className="micro-label">Tgl Expired</p>
                    <p className="font-data mt-0.5 text-sm">
                      {detailItem.tanggal_expired}
                    </p>
                  </div>
                  {detailItem.mfg_date && (
                    <div>
                      <p className="micro-label">MFG Date</p>
                      <p className="font-data mt-0.5 text-sm">
                        {detailItem.mfg_date}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="micro-label">Tanda Tangan</p>
                    <p className="mt-0.5 text-sm">
                      {detailItem.tanda_tangan_digital}
                    </p>
                  </div>
                </div>

                {detailItem.hasil_uji_snapshot?.items?.length > 0 && (
                  <div className="border-t border-border pt-4">
                    <p className="micro-label">Hasil Uji</p>
                    <ResultTable items={detailItem.hasil_uji_snapshot.items} />
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
