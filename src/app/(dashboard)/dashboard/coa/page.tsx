"use client";
import { RowActions } from "@/components/workspace/row-actions";
import { Download } from "lucide-react";
import { PdfPreview } from "@/components/workspace/pdf-preview";
import {
  DataTools,
  CopyValue,
  useSearchSeed,
  emptyFilters,
  type AdvancedFilters,
} from "@/components/workspace/data-tools";
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
import type { CoaRow, HasilUjiRow, UserRole } from "@/lib/types";
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

interface COAForm {
  language: "id" | "en";
  inci_name: string;
  compliance_statement: string;
  delivery_date: string;
  id_hasil: string;
  no_coa: string;
  tanggal_rilis: string;
  tanggal_expired: string;
  mfg_date: string;
  tanda_tangan: string;
}

const emptyForm: COAForm = {
  language: "en",
  inci_name: "",
  compliance_statement: "",
  delivery_date: "",
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
    <Badge variant="destructive">Expired</Badge>
  ) : (
    <Badge>Valid</Badge>
  );
}

export default function COAPage() {
  const confirm = useConfirm();
  const [filter, setFilter] = useState("all");
  const [order, setOrder] = useState("default");
  const [advanced, setAdvanced] = useState<AdvancedFilters>({
    ...emptyFilters,
  });
  useSearchSeed(onSearchChange);
  const requestSeq = useRef(0);
  const navigating = useRef(false);
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);
  const previewToken = useRef("");
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );
  function closePreview() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    previewToken.current = "";
    setPreviewUrl(null);
  }

  // Fetch one bounded page and its filtered total.
  const [pageSize] = useState(50);
  const [offset, setOffset] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [paging, setPaging] = useState(false);

  const runQuery = useCallback(
    async (start: number, pageRequest: boolean) => {
      if (pageRequest && navigating.current) return;
      navigating.current = pageRequest;
      const seq = ++requestSeq.current;
      if (pageRequest) setPaging(true);
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
      if (advanced.from) q = q.gte("tanggal_rilis", advanced.from);
      if (advanced.to) q = q.lte("tanggal_rilis", advanced.to);
      if (advanced.product) q = q.eq("id_produk", advanced.product);
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
        if (pageRequest) setPaging(false);
        return;
      }
      if (error) {
        if (!pageRequest) {
          setLoadError(true);
          setCoaList([]);
          setTotalCount(0);
        }
        toast.error("Could not load data. Retry.");
      } else {
        const rows = (raw as CoaRow[]) ?? [];
        setLoadError(false);
        setCoaList(rows);
        setTotalCount(count ?? 0);
        setOffset(start);
      }
      navigating.current = false;
      setPaging(false);
      setLoading(false);
    },
    [search, pageSize, filter, order, advanced],
  );

  const fetchData = useCallback(() => {
    setOffset(0);
    return runQuery(0, false);
  }, [runQuery]);

  const goToPage = useCallback(
    (page: number) => runQuery((page - 1) * pageSize, true),
    [runQuery, pageSize],
  );

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
      navigating.current = false;
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
      language: coa.language || "en",
      inci_name: coa.inci_name || coa.hasil_uji_snapshot.inci_name || "",
      compliance_statement: coa.compliance_statement || "",
      delivery_date: coa.delivery_date || "",
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

  async function preparePreview() {
    if (editingId) {
      await handleSave();
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/coa/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) {
        const body = await r.json();
        toast.error(body.message || "Could not create the preview.");
        return;
      }
      const blob = await r.blob();
      closePreview();
      previewToken.current = r.headers.get("X-COA-Preview-Token") || "";
      const url = URL.createObjectURL(blob);
      previewRef.current = url;
      setPreviewUrl(url);
    } catch {
      toast.error("Connection lost. Retry.");
    } finally {
      setSaving(false);
    }
  }
  async function handleSave() {
    if (editingId) {
      if (!form.no_coa) {
        toast.error("COA number is required.");
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
          language: form.language,
          inci_name: form.inci_name,
          compliance_statement: form.compliance_statement,
          delivery_date: form.delivery_date,
        });
        if (!res.ok) {
          toast.error(res.error ?? "Could not save the COA. Retry.");
          return;
        }
        toast.success("COA updated.");
        setDialogOpen(false);
        resetForm();
        fetchData();
      } catch {
        toast.error("Could not reach the server. Retry.");
      } finally {
        setSaving(false);
      }
      return;
    }

    // Create new COA from hasil_uji
    if (!form.id_hasil) {
      toast.error("Select an inspection.");
      return;
    }
    setSaving(true);
    try {
      // Server action: nomor otomatis + snapshot + foreign key diturunkan
      // dari baris hasil uji DI SERVER; 23505 race di-retry di sana.
      const res = await issueCoaAction({
        preview_token: previewToken.current,
        id_hasil: form.id_hasil,
        no_coa: form.no_coa,
        tanggal_rilis: form.tanggal_rilis,
        tanggal_expired: form.tanggal_expired,
        mfg_date: form.mfg_date,
        tanda_tangan: form.tanda_tangan,
        language: form.language,
        inci_name: form.inci_name,
        compliance_statement: form.compliance_statement,
        delivery_date: form.delivery_date,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Could not issue the COA.");
        return;
      }
      closePreview();
      toast.success("COA issued.");
      setDialogOpen(false);
      resetForm();
      fetchData();
      fetchAvailableHasil();
    } catch {
      toast.error("Could not reach the server. Retry.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (
      !(await confirm({
        title: "Delete this COA?",
        description: "This cannot be undone.",
        confirmLabel: "Delete record",
      }))
    )
      return;

    // Server action: role check server-side.
    try {
      const res = await deleteCoaAction(id);
      if (!res.ok) {
        toast.error(res.error ?? "Could not delete the COA. Retry.");
        return;
      }
      toast.success("COA deleted.");
      fetchData();
      fetchAvailableHasil();
    } catch {
      toast.error("Could not reach the server. Retry.");
    }
  }

  function handlePrint(coa: CoaRow) {
    window.open(`/api/coa/${coa.id}/pdf`, "_blank", "noopener,noreferrer");
  }
  async function downloadPdf(coa: CoaRow) {
    try {
      const r = await fetch(`/api/coa/${coa.id}/pdf?download=1`);
      if (!r.ok) {
        const data = await r.json();
        toast.error(data.message || "Could not create the PDF.");
        return;
      }
      const url = URL.createObjectURL(await r.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = coa.no_coa.replace(/[^a-zA-Z0-9_.-]/g, "_") + ".pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      toast.error("Connection lost. Retry.");
    }
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
        eyebrow="Certification"
        title="Certificate of Analysis"
        description="Issue and manage certificates of analysis."
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
                  <Plus className="size-4" /> Issue COA
                </Button>
              }
            />
          )}

          <DialogContent className="flex max-h-[90svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
            <DialogHeader className="gap-1 border-b border-border-soft px-6 py-4 pr-14">
              <p className="micro-label">CERTIFICATE</p>
              <DialogTitle className="text-2xl font-semibold tracking-tight">
                {editingId ? "Edit COA" : "Issue COA"}
              </DialogTitle>
              <DialogDescription className="mt-2 text-xs leading-relaxed">
                Select a passed inspection and enter the certificate details.
              </DialogDescription>
            </DialogHeader>
            <DomainForm
              value={{ ...form, id: editingId }}
              schema={editingId ? updateCoaSchema : issueSchema}
              onSubmit={preparePreview}
            >
              {/* Scrollable body; the hairline footer stays pinned below it. */}
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <div className="space-y-5">
                  {!editingId && (
                    <div className="space-y-1.5">
                      <Field label="Passed inspection" name="id_hasil" required>
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
                          <option value="">Select an inspection…</option>
                          {availableHasil.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.no_lot} — {h.master_produk?.nama_produk || ""}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {availableError && (
                        <p role="alert">
                          Could not load test results.{" "}
                          <button
                            type="button"
                            onClick={() => void fetchAvailableHasil()}
                          >
                            Retry
                          </button>
                        </p>
                      )}
                      {availableLoading && <p>Loading test results…</p>}
                      {!availableError &&
                        !availableLoading &&
                        availableHasil.length === 0 && (
                          <p className="text-[13px] text-muted">
                            No passed inspections available.
                          </p>
                        )}
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Document language" name="language">
                      <select
                        value={form.language}
                        onChange={(e) =>
                          setForm((v) => ({
                            ...v,
                            language: e.target.value as "id" | "en",
                          }))
                        }
                      >
                        <option value="en">English</option>
                        <option value="id">Indonesian</option>
                      </select>
                    </Field>
                    <Field label="INCI name" name="inci_name">
                      <Input
                        value={form.inci_name}
                        onChange={(e) =>
                          setForm((v) => ({ ...v, inci_name: e.target.value }))
                        }
                        placeholder="Product INCI name"
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <Field label="COA number" name="no_coa">
                      <Input
                        value={form.no_coa}
                        disabled={!canWrite}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            no_coa: e.target.value,
                          }))
                        }
                        placeholder="Assigned automatically if empty"
                      />
                    </Field>
                    <Field label="Release date" name="tanggal_rilis" required>
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
                    <Field label="Expiry date" name="tanggal_expired" required>
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
                    label="Issuer name"
                    hint="Approver shown on the certificate."
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
                      placeholder="Approver name"
                    />
                  </Field>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Delivery date" name="delivery_date">
                      <Input
                        type="date"
                        value={form.delivery_date}
                        onChange={(e) =>
                          setForm((v) => ({
                            ...v,
                            delivery_date: e.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field
                      label="Compliance statement"
                      name="compliance_statement"
                      hint="Enter the applicable standard in the document language."
                    >
                      <textarea
                        className="w-full rounded-control border border-input p-3 text-sm"
                        value={form.compliance_statement}
                        maxLength={3000}
                        onChange={(e) =>
                          setForm((v) => ({
                            ...v,
                            compliance_statement: e.target.value,
                          }))
                        }
                      />
                    </Field>
                  </div>
                  {!editingId && selectedHasil && (
                    <div className="border-t border-border pt-4">
                      <p className="micro-label">Preview test results</p>
                      <div className="mt-3">
                        <ResultTable items={selectedHasil.hasil_detail ?? []} />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter className="m-0 flex-row items-center justify-between gap-2 rounded-b-lg px-6 py-4 sm:justify-between">
                <DialogClose
                  render={<Button variant="outline">Cancel</Button>}
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
                    {saving ? "Saving…" : editingId ? "Save" : "Preview COA"}
                  </Button>
                )}
              </DialogFooter>
            </DomainForm>
          </DialogContent>
        </DomainDialog>
      </PageHeader>

      <div>
        <FilterTabs
          label="Filter COAs"
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: "All COAs" },
            { value: "active", label: "Valid" },
            { value: "expired", label: "Expired" },
          ]}
        />
        <DataToolbar
          search={searchInput}
          onSearch={onSearchChange}
          placeholder="Search COAs or products…"
          total={totalCount}
          loading={loading}
          onRefresh={() => void fetchData()}
          order={order}
          onOrder={setOrder}
        />
      </div>

      {/* Table card: hairline border, radius 8, header micro-labels on surface-alt */}
      <DataTools
        module="coa"
        search={search}
        filter={filter}
        order={order}
        filters={advanced}
        onFilters={setAdvanced}
        loading={loading}
      />
      <div className="data-card">
        <Table data-actions>
          <TableHeader>
            <TableRow className="hover:bg-surface-alt">
              <TableHead className="pl-4">COA number</TableHead>
              <TableHead>Products</TableHead>
              <TableHead>Lot number</TableHead>
              <TableHead className="text-right">Release date</TableHead>
              <TableHead className="text-right">Expiry date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-4">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableSkeleton rows={5} cols={7} />}
            {!loading && loadError && (
              <TableRow>
                <TableCell colSpan={7} className="!p-0">
                  <EmptyState
                    error
                    title="Could not load data"
                    description="Check your connection and reload."
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fetchData()}
                    >
                      Retry
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
                      {search ||
                      filter !== "all" ||
                      Object.values(advanced).some(Boolean)
                        ? "No matching results"
                        : "No certificates yet"}
                    </p>
                    <p className="text-xs text-muted">
                      {search ||
                      filter !== "all" ||
                      Object.values(advanced).some(Boolean)
                        ? "Try another keyword or clear your filters."
                        : "Add your first record to get started."}
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
                        <Plus className="size-3.5" /> Issue COA
                      </Button>
                    )}
                    {(search ||
                      filter !== "all" ||
                      Object.values(advanced).some(Boolean)) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          onSearchChange("");
                          setFilter("all");
                          setAdvanced({ ...emptyFilters });
                        }}
                      >
                        Clear filters
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
                    <RowActions>
                      <CopyValue value={coa.no_coa} label="Copy COA number" />
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
                        title="Download PDF"
                        onClick={() => void downloadPdf(coa)}
                      >
                        <Download className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        className="row-action"
                        onClick={() => handlePrint(coa)}
                        title="Print"
                      >
                        <Printer className="size-3.5" />
                      </button>
                      {canDelete && (
                        <button
                          type="button"
                          className="row-action"
                          data-tone="danger"
                          onClick={() => handleDelete(coa.id)}
                          title="Delete"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </RowActions>
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
          loading={paging}
          page={Math.floor(offset / pageSize) + 1}
          pageSize={pageSize}
          onPageChange={(p) => void goToPage(p)}
        />
      )}

      <PdfPreview
        url={previewUrl}
        onClose={closePreview}
        onIssue={handleSave}
        busy={saving}
      />
      {/* Detail dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="flex max-h-[90svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="gap-1 border-b border-border-soft px-6 py-4 pr-14">
            <p className="micro-label">CERTIFICATE</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">
              COA details
            </DialogTitle>
            <DialogDescription>
              Test results captured when the certificate was issued.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {detailItem && (
              <div className="space-y-5">
                <div className="detail-metadata grid grid-cols-1 gap-5 rounded-xl border border-border-soft bg-surface-alt p-5 sm:grid-cols-2">
                  <div>
                    <p className="micro-label">COA number</p>
                    <p className="font-data mt-0.5 text-sm">
                      {detailItem.no_coa}
                    </p>
                  </div>
                  <div>
                    <p className="micro-label">Products</p>
                    <p className="mt-0.5 text-sm font-medium">
                      {detailItem.hasil_uji_snapshot?.produk || "-"}
                    </p>
                  </div>
                  <div>
                    <p className="micro-label">Lot number</p>
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
                    <p className="micro-label">Release date</p>
                    <p className="font-data mt-0.5 text-sm">
                      {detailItem.tanggal_rilis}
                    </p>
                  </div>
                  <div>
                    <p className="micro-label">Expiry date</p>
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
                    <p className="micro-label">Approver</p>
                    <p className="mt-0.5 text-sm">
                      {detailItem.tanda_tangan_digital}
                    </p>
                  </div>
                </div>

                {detailItem.hasil_uji_snapshot?.items?.length > 0 && (
                  <div className="border-t border-border pt-4">
                    <p className="micro-label">Test results</p>
                    <ResultTable items={detailItem.hasil_uji_snapshot.items} />
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="m-0 flex-row items-center justify-end gap-2 rounded-b-lg px-6 py-4 sm:justify-end">
            <DialogClose render={<Button variant="outline">Close</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
