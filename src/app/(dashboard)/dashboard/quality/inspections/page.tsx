"use client";
import { useTableState } from "@/components/tables/use-table-state";
import { AdvancedRecordsTable } from "@/components/tables/advanced-records-table";
import { applyTableQuery } from "@/lib/tables/postgrest";
import { ERPPicker } from "@/components/erp/picker";
import type { ERPRow } from "@/lib/erp/schema";
import { useERP } from "@/components/erp/context";
import { RowActions } from "@/components/workspace/row-actions";
import { saveDraftAction } from "@/lib/actions/inspeksi-actions";
import { DraftPanel } from "@/components/workspace/draft-panel";
import { draftDataSchema } from "@/lib/domain/validation";
import type { InspectionDraft } from "@/lib/types";
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
import { inspectionSchema } from "@/lib/domain/validation";

import { businessDate, evaluateParam } from "@/lib/domain/validation";

import {
  useEffect,
  useState,
  useCallback,
  useRef,
  useEffectEvent,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/app/(dashboard)/user-context";
import { canAction } from "@/lib/types";
import type {
  HasilUjiRow,
  MasterProduk,
  SpesifikasiItem,
  UserRole,
} from "@/lib/types";
import { toast } from "sonner";
import {
  saveInspeksiAction,
  deleteInspeksiAction,
} from "@/lib/actions/inspeksi-actions";
import { Plus, Pencil, Trash2, Eye, FlaskConical } from "lucide-react";
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
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

// Module-level browser client: a single instance instead of one per render.
const sb = createClient();

// Monotonic counter used to ignore stale list-fetch responses.

// Monotonic counter used to ignore stale spesifikasi fetches (openEdit race,
// rapid product switches).

// Monotonic counter used to ignore stale openEdit resolutions (clicking
// Edit(A) then Edit(B), or opening the new-form dialog, while A is in flight).

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

// Status is always a dot-chip: emerald tint for PASS, danger tint otherwise.
function StatusBadge({ status }: { status: string }) {
  if (status === "PASS") return <Badge>PASS</Badge>;
  return <Badge variant="destructive">{status}</Badge>;
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
  tgl_sampling: "",
  tgl_uji: "",
  inspector: "",
  catatan: "",
};

// Native select styled to match the Input kit (hairline border, 36px, 6px
// radius); focus border + ring come from the global input/select rule.
const selectClass =
  "h-9 w-full rounded-md border border-input bg-surface px-2.5 text-sm transition-colors duration-150 outline-none";

// Native textarea styled to match the Input kit; focus comes from the global
// textarea rule (emerald border + ring).
const textareaClass =
  "min-h-16 w-full rounded-md border border-input bg-surface px-2.5 py-1.5 text-sm transition-colors duration-150 outline-none";

export default function InspeksiPage() {
  const erp = useERP();
  const qualityWrite = erp.can("quality", "write");
  const productionOn = erp.data?.modules.some(
    (m) => m.key === "production" && m.state !== "disabled",
  );
  const [selectedLot, setSelectedLot] = useState<ERPRow | null>(null);
  const confirm = useConfirm();
  const [filter, setFilter] = useState("all");
  const [order, setOrder] = useState("default");
  const [advanced, setAdvanced] = useState<AdvancedFilters>({
    ...emptyFilters,
  });
  useSearchSeed(onSearchChange);
  const requestSeq = useRef(0);
  const specSeq = useRef(0);
  const editSeq = useRef(0);
  const [specProductId, setSpecProductId] = useState<string | null>(null);
  const [specLoading, setSpecLoading] = useState(false);
  const navigating = useRef(false);
  const { user } = useUser();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [data, setData] = useState<HasilUjiRow[]>([]);
  const [produkList, setProdukList] = useState<MasterProduk[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<HasilUjiRow | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<UjiForm>(emptyForm);
  const [spesifikasi, setSpesifikasi] = useState<SpesifikasiItem[]>([]);
  const [hasilValues, setHasilValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftRefresh, setDraftRefresh] = useState(0);
  const [failureReason, setFailureReason] = useState("");
  const [resumedDraft, setResumedDraft] = useState(false);
  const [englishValues, setEnglishValues] = useState<Record<string, string>>(
    {},
  );

  // Fetch one bounded page and its filtered total.
  const [pageSize] = useState(50);
  const [offset, setOffset] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [paging, setPaging] = useState(false);

  // Which product the current hasilValues belong to. Values are kept only
  // while the selected product is unchanged; any product switch wipes them,
  // because parameter names collide across products and stale values would
  // be saved under the wrong product's parameters.

  const table = useTableState("hasil_uji");
  const runQuery = useCallback(
    async (start: number, pageRequest: boolean) => {
      if (pageRequest && navigating.current) return;
      navigating.current = pageRequest;
      const seq = ++requestSeq.current;
      if (pageRequest) setPaging(true);
      else setLoading(true);
      let q = applyTableQuery(
        sb
          .from("hasil_uji")
          .select("*, master_produk!inner(kode_produk, nama_produk)", {
            count: "exact",
          }),
        table.query,
      )
        .order("created_at", { ascending: order === "oldest" })
        .order("id")
        .range(start, start + pageSize - 1);
      if (filter !== "all") q = q.eq("status", filter);
      if (advanced.from) q = q.gte("tgl_uji", advanced.from);
      if (advanced.to) q = q.lte("tgl_uji", advanced.to);
      if (advanced.product) q = q.eq("id_produk", advanced.product);
      if (advanced.person)
        q = q.ilike(
          "inspector",
          "%" + advanced.person.replace(/[\\%_]/g, "\\$&") + "%",
        );
      if (search) {
        // Quoted values (via escapeOr): commas/parens stay literal and the
        // escaped %/_ reach Postgres LIKE as literals, not wildcards.
        const term = escapeOr(search);
        q = q.or(`no_lot.ilike."%${term}%",product_name.ilike."%${term}%"`);
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
          setData([]);
          setTotalCount(0);
        }
        toast.error("Could not load data. Retry.");
      } else {
        const rows = (raw as HasilUjiRow[]) ?? [];
        setLoadError(false);
        setData(rows);
        setTotalCount(count ?? 0);
        setOffset(start);
      }
      navigating.current = false;
      setPaging(false);
      setLoading(false);
    },
    [search, pageSize, filter, order, advanced, table.query],
  );

  const fetchData = useCallback(() => {
    setOffset(0);
    return runQuery(0, false);
  }, [runQuery]);

  const goToPage = useCallback(
    (page: number) => runQuery((page - 1) * pageSize, true),
    [runQuery, pageSize],
  );

  const fetchProduk = useCallback(async () => {
    const all: MasterProduk[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await sb
        .from("master_produk")
        .select("*")
        .order("nama_produk")
        .order("id")
        .range(offset, offset + 499);
      if (error) {
        setProdukList([]);
        toast.error("Could not load products. Reload the page.");
        return;
      }
      all.push(...((data || []) as MasterProduk[]));
      if (!data || data.length < 500) break;
    }
    setProdukList(all);
  }, []);

  // Pure loader: only fills spesifikasi state, never touches hasilValues.
  const fetchSpesifikasi = useCallback(
    async (id_produk: string) => {
      const seq = ++specSeq.current;
      setSpecProductId(null);
      setSpesifikasi([]);
      setSpecLoading(true);
      if (!id_produk) {
        setSpesifikasi([]);
        setSpecLoading(false);
        return false;
      }
      const { data, error } = await sb
        .from("spesifikasi")
        .select("*")
        .eq("id_produk", id_produk)
        .order("urutan");
      if (seq !== specSeq.current) return; // superseded by a newer fetch
      if (error) {
        setSpesifikasi([]);
        toast.error("Could not load data. Retry.");
        setSpecLoading(false);
        return false;
      }
      setSpecProductId(id_produk);
      setSpecLoading(false);
      setSpesifikasi((data as SpesifikasiItem[]) ?? []);
      return true;
    },
    [setSpecProductId, setSpesifikasi, setSpecLoading],
  );

  useEffect(() => {
    const sequence = requestSeq;
    const timer = setTimeout(() => {
      void fetchData();
      void fetchProduk();
    }, 0);
    return () => {
      clearTimeout(timer);
      sequence.current++;
      navigating.current = false;
    };
  }, [fetchData, fetchProduk]);

  // Clear the pending debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  function selectInspectionLot(lot: ERPRow) {
    setSelectedLot(lot);
    changeProduct(lot.product_id!);
    setForm((prev) => ({
      ...prev,
      id_produk: lot.product_id!,
      no_lot: lot.number || "",
    }));
  }
  const openLinkedLot = useEffectEvent((lot: ERPRow) => {
    if (lot.inspection_id) {
      setSearchInput(lot.number || "");
      setSearch(lot.number || "");
      toast.info(
        "This lot already has an inspection. Open its existing record.",
      );
      return;
    }
    resetForm();
    selectInspectionLot(lot);
    setDialogOpen(true);
  });
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("lot");
    if (!id) return;
    const abort = new AbortController();
    void fetch("/api/erp/inspection_lots?id=" + encodeURIComponent(id), {
      signal: abort.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error();
        const d = await r.json();
        if (!abort.signal.aborted && d.rows?.[0]) openLinkedLot(d.rows[0]);
      })
      .catch(() => {
        if (!abort.signal.aborted)
          toast.error("Could not open this lot. Check access and retry.");
      });
    return () => abort.abort();
  }, []);
  function changeProduct(id: string) {
    editSeq.current++;
    setForm((prev) => ({ ...prev, id_produk: id }));
    setHasilValues({});
    setEnglishValues({});
    void fetchSpesifikasi(id);
  }

  function onSearchChange(value: string) {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(value), 300);
  }

  function resetForm() {
    setSelectedLot(null);
    setDraftId(null);
    setFailureReason("");
    setResumedDraft(false);
    setEnglishValues({});
    specSeq.current++;
    editSeq.current++;
    setSpecProductId(null);
    setSpecLoading(false);
    setForm({
      ...emptyForm,
      inspector: user?.nama_lengkap || "",
      tgl_sampling: businessDate(),
      tgl_uji: businessDate(),
    });
    setSpesifikasi([]);
    setHasilValues({});
    setEditingId(null);
  }

  async function openEdit(item: HasilUjiRow) {
    const seq = ++editSeq.current;
    setEditingId(item.id);
    setDraftId(null);
    setFailureReason(item.failure_reason || "");
    setResumedDraft(false);
    setForm({
      id_produk: item.id_produk,
      no_lot: item.no_lot,
      tgl_sampling: item.tgl_sampling,
      tgl_uji: item.tgl_uji,
      inspector: item.inspector,
      catatan: item.catatan ?? "",
    });

    // Load spesifikasi first, THEN populate hasil values, so no code path
    // can wipe the values after they are set.
    const loaded = await fetchSpesifikasi(item.id_produk);
    if (!loaded) return;

    // A newer Edit click (or a new-form dialog open) superseded this one;
    // applying A's resolved values under B's form would corrupt row B on save.
    if (seq !== editSeq.current) return;

    const vals: Record<string, string> = {};
    if (item.hasil_detail) {
      for (const h of item.hasil_detail) {
        vals[h.p] = h.val;
      }
    }
    setHasilValues(vals);
    setEnglishValues(
      Object.fromEntries(
        (item.hasil_detail || []).map((h) => [h.p, h.val_en || ""]),
      ),
    );

    setDialogOpen(true);
  }

  function openDetail(item: HasilUjiRow) {
    setDetailItem(item);
    setDetailOpen(true);
  }

  // null = nothing filled in yet (rendered as neutral), otherwise PASS/FAIL.
  function computeOverallStatus(): "PASS" | "FAIL" | null {
    if (spesifikasi.length === 0) return null;
    const hasAnyValue = spesifikasi.some(
      (sp) => (hasilValues[sp.parameter_uji] ?? "") !== "",
    );
    if (!hasAnyValue) return null;
    for (const sp of spesifikasi) {
      if (evaluateParam(sp, hasilValues[sp.parameter_uji] ?? "") === "FAIL") {
        return "FAIL";
      }
    }
    return "PASS";
  }

  function buildHasilDetail() {
    return spesifikasi.map((sp) => ({
      spec_id: sp.id,
      p: sp.parameter_uji,
      t: sp.tipe_batas,
      mn: sp.nilai_min ?? "",
      mx: sp.nilai_maks ?? "",
      u: sp.satuan ?? "",
      k: sp.keterangan ?? "",
      val: hasilValues[sp.parameter_uji] ?? "",
      val_en: englishValues[sp.parameter_uji] ?? "",
      st: evaluateParam(sp, hasilValues[sp.parameter_uji] ?? ""),
    }));
  }

  async function handleSave() {
    if (
      specLoading ||
      specProductId !== form.id_produk ||
      spesifikasi.length === 0
    ) {
      toast.error("Select a product and wait for its specifications to load.");
      return;
    }
    if (!form.id_produk || !form.no_lot) {
      toast.error("Product and lot number are required.");
      return;
    }
    setSaving(true);

    const detail = buildHasilDetail();
    const status = computeOverallStatus() ?? "FAIL";

    try {
      // Mutasi lewat server action: sesi + peran dicek server-side.
      const res = await saveInspeksiAction({
        id: editingId,
        draft_id: draftId,
        failure_reason: failureReason,
        id_produk: form.id_produk,
        no_lot: form.no_lot,
        tgl_sampling: form.tgl_sampling,
        tgl_uji: form.tgl_uji,
        inspector: form.inspector,
        catatan: form.catatan,
        hasil_detail: detail,
        status,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Could not save the inspection. Retry.");
        return;
      }
      toast.success(editingId ? "Inspection updated." : "Inspection added.");
      setDialogOpen(false);
      resetForm();
      setDraftRefresh((v) => v + 1);
      fetchData();
    } catch {
      toast.error("Could not reach the server. Retry.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDraftSave() {
    if (editingId) return;
    setSaving(true);
    try {
      const r = await saveDraftAction({
        id: draftId,
        data: {
          ...form,
          failure_reason: failureReason,
          hasil_detail: buildHasilDetail(),
        },
      });
      if (!r.ok) {
        toast.error(r.error || "Could not save the draft.");
        return;
      }
      setDialogOpen(false);
      resetForm();
      setDraftRefresh((v) => v + 1);
      toast.success("Draft saved.");
    } catch {
      toast.error("Connection lost. Retry.");
    } finally {
      setSaving(false);
    }
  }
  async function resumeDraft(draft: InspectionDraft) {
    const parsed = draftDataSchema.safeParse(draft.payload);
    if (!parsed.success) {
      toast.error("Invalid draft format. Contact your administrator.");
      return;
    }
    const values = parsed.data;
    resetForm();
    if (values.id_produk && !(await fetchSpesifikasi(values.id_produk))) return;
    setForm({
      id_produk: values.id_produk,
      no_lot: values.no_lot,
      tgl_sampling: values.tgl_sampling,
      tgl_uji: values.tgl_uji,
      inspector: values.inspector,
      catatan: values.catatan,
    });
    setHasilValues(
      Object.fromEntries(values.hasil_detail.map((h) => [h.p, h.val])),
    );
    setEnglishValues(
      Object.fromEntries(values.hasil_detail.map((h) => [h.p, h.val_en || ""])),
    );
    setFailureReason(values.failure_reason);
    setDraftId(draft.id);
    setResumedDraft(true);
    setDialogOpen(true);
  }

  async function handleDelete(id: string) {
    if (
      !(await confirm({
        title: "Delete this inspection?",
        description: "This cannot be undone.",
        confirmLabel: "Delete record",
      }))
    )
      return;

    // Server action: role check server-side.
    try {
      const res = await deleteInspeksiAction(id);
      if (!res.ok) {
        toast.error(res.error ?? "Could not delete the inspection. Retry.");
        return;
      }
      toast.success("Inspection deleted.");
      fetchData();
    } catch {
      toast.error("Could not reach the server. Retry.");
    }
  }

  const role: UserRole = (user?.role as UserRole) ?? "viewer";
  const canDelete = qualityWrite && canAction(user || role, "delete_uji");
  const canCreate = qualityWrite && canAction(user || role, "create_uji");
  const canUpdate = qualityWrite && canAction(user || role, "update_uji");
  const overallStatus = computeOverallStatus();

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Quality control"
        title="Inspections"
        description="Results, parameters, and status by lot."
      >
        <DomainDialog
          dirtyValue={{ form, hasilValues, failureReason, englishValues }}
          busy={saving}
          open={dialogOpen}
          onOpenChange={(v) => {
            if (v) {
              editSeq.current++;
              if (!editingId) resetForm();
            }
            setDialogOpen(v);
            if (!v) resetForm();
          }}
        >
          {canCreate && (
            <DialogTrigger
              render={
                <Button>
                  <Plus className="size-4" /> New inspection
                </Button>
              }
            />
          )}

          <DialogContent className="inspection-editor mobile-fullscreen-form flex max-h-[90svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
            <DialogHeader className="gap-1 border-b border-border-soft px-6 py-4 pr-14">
              <p className="micro-label">INSPECTIONS</p>
              <DialogTitle className="text-2xl font-semibold tracking-tight">
                {editingId ? "Edit inspection" : "New inspection"}
              </DialogTitle>
              <DialogDescription className="mt-2 text-xs leading-relaxed">
                Select a lot, then record its test results. Save a draft to
                continue later.
              </DialogDescription>
            </DialogHeader>
            <DomainForm
              value={{
                ...form,
                id: editingId,
                hasil_detail: buildHasilDetail(),
                failure_reason: failureReason,
                status: computeOverallStatus() || undefined,
              }}
              schema={inspectionSchema}
              onSubmit={handleSave}
            >
              {/* Scrollable body; the footer stays pinned below it. */}
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <div className="space-y-6">
                  {resumedDraft && (
                    <p className="form-notice">
                      Draft restored. Check the current specifications before
                      saving.
                    </p>
                  )}
                  {/* Uji fields: two-column grid */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {productionOn && !editingId ? (
                      <div className="sm:col-span-2">
                        <ERPPicker
                          entity="inspection_lots"
                          label="Production / received lot"
                          value={selectedLot}
                          onChange={selectInspectionLot}
                        />
                        {selectedLot && (
                          <p className="erp-notice">
                            {selectedLot.product} · Manufactured{" "}
                            {selectedLot.mfg_date || "—"} · Expires{" "}
                            {selectedLot.expiry_date || "—"}
                          </p>
                        )}
                      </div>
                    ) : (
                      <>
                        <Field
                          label="Product *"
                          name="id_produk"
                          className="sm:col-span-2"
                          required
                        >
                          <select
                            className={selectClass}
                            value={form.id_produk}
                            onChange={(e) => changeProduct(e.target.value)}
                          >
                            <option value="">Select a product…</option>
                            {produkList.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.kode_produk} — {p.nama_produk}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Lot number *" name="no_lot" required>
                          <Input
                            value={form.no_lot}
                            onChange={(e) =>
                              setForm({ ...form, no_lot: e.target.value })
                            }
                            placeholder="LOT-001"
                          />
                        </Field>
                      </>
                    )}
                    <Field label="Inspector" name="inspector" required>
                      <Input
                        value={form.inspector}
                        onChange={(e) =>
                          setForm({ ...form, inspector: e.target.value })
                        }
                        placeholder="Inspector name"
                      />
                    </Field>
                    <Field label="Sampling date" name="tgl_sampling" required>
                      <Input
                        type="date"
                        value={form.tgl_sampling}
                        onChange={(e) =>
                          setForm({ ...form, tgl_sampling: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Test date" name="tgl_uji" required>
                      <Input
                        type="date"
                        value={form.tgl_uji}
                        onChange={(e) =>
                          setForm({ ...form, tgl_uji: e.target.value })
                        }
                      />
                    </Field>
                  </div>

                  <Field label="Notes" name="catatan">
                    <textarea
                      className={textareaClass}
                      value={form.catatan}
                      onChange={(e) =>
                        setForm({ ...form, catatan: e.target.value })
                      }
                      placeholder="Notes (optional)"
                    />
                  </Field>

                  {/* Dynamic hasil input */}
                  {spesifikasi.length > 0 && (
                    <div className="border-t border-border pt-5">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <span className="micro-label">Test results</span>
                        <span className="text-xs text-muted">
                          {
                            spesifikasi.filter(
                              (sp) =>
                                (hasilValues[sp.parameter_uji] || "").trim() !==
                                "",
                            ).length
                          }{" "}
                          / {spesifikasi.length} completed
                        </span>
                      </div>

                      <div className="space-y-2">
                        {spesifikasi.map((sp) => {
                          const val = hasilValues[sp.parameter_uji] ?? "";
                          const res =
                            val !== "" ? evaluateParam(sp, val) : null;
                          return (
                            <div key={sp.id} className="inspection-parameter">
                              <div className="min-w-0 flex-1">
                                <span className="text-sm font-medium">
                                  {sp.parameter_uji}
                                </span>
                                {sp.tipe_batas !== "TEXT" && (
                                  <span className="font-data ml-2 text-[11px] text-muted">
                                    ({sp.tipe_batas}:{" "}
                                    {sp.tipe_batas === "MAX"
                                      ? sp.nilai_maks
                                      : sp.nilai_min}
                                    {sp.tipe_batas === "RANGE" &&
                                      ` — ${sp.nilai_maks}`}
                                    {sp.satuan && ` ${sp.satuan}`})
                                  </span>
                                )}
                              </div>
                              <Input
                                className="w-full"
                                aria-label={`Result ${sp.parameter_uji}`}
                                numberFormat="raw"
                                inputMode={
                                  sp.tipe_batas === "TEXT" ? "text" : "decimal"
                                }
                                placeholder={
                                  sp.tipe_batas === "TEXT" ? "Value" : "0"
                                }
                                enterKeyHint="next"
                                value={val}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    const inputs = Array.from(
                                      e.currentTarget
                                        .closest("form")!
                                        .querySelectorAll<HTMLInputElement>(
                                          'input[aria-label^="Result "]',
                                        ),
                                    );
                                    inputs[
                                      inputs.indexOf(e.currentTarget) + 1
                                    ]?.focus();
                                  }
                                }}
                                onChange={(e) => {
                                  setHasilValues({
                                    ...hasilValues,
                                    [sp.parameter_uji]: e.target.value,
                                  });
                                }}
                              />
                              {res && (
                                <Badge
                                  variant={
                                    res === "PASS" ? "default" : "destructive"
                                  }
                                >
                                  {res}
                                </Badge>
                              )}
                              {sp.tipe_batas === "TEXT" && (
                                <label className="inspection-translation">
                                  Result in English (optional)
                                  <Input
                                    value={
                                      englishValues[sp.parameter_uji] || ""
                                    }
                                    onChange={(e) =>
                                      setEnglishValues((v) => ({
                                        ...v,
                                        [sp.parameter_uji]: e.target.value,
                                      }))
                                    }
                                    placeholder="Uses the original result if empty"
                                    maxLength={1000}
                                  />
                                </label>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-4 flex items-center gap-2">
                        <span className="text-xs font-medium">
                          Final status:
                        </span>
                        {overallStatus === null ? (
                          <Badge variant="secondary">Not provided</Badge>
                        ) : (
                          <StatusBadge status={overallStatus} />
                        )}
                      </div>
                    </div>
                  )}
                  {overallStatus === "FAIL" && (
                    <Field
                      label="Failure reason"
                      name="failure_reason"
                      required
                      hint="Describe the failed parameters, findings, and next steps."
                    >
                      <textarea
                        className={textareaClass}
                        value={failureReason}
                        onChange={(e) => setFailureReason(e.target.value)}
                        maxLength={5000}
                        required
                      />
                    </Field>
                  )}
                  {form.id_produk && spesifikasi.length === 0 && (
                    <p className="text-[13px] text-muted">
                      This product has no test specifications.
                    </p>
                  )}
                </div>
              </div>

              <DialogFooter className="m-0 flex-row items-center justify-between gap-2 rounded-b-lg px-6 py-4 sm:justify-between">
                <DialogClose
                  render={<Button variant="outline">Cancel</Button>}
                />
                {!editingId && (
                  <Button
                    variant="outline"
                    onClick={() => void handleDraftSave()}
                    disabled={saving || specLoading}
                  >
                    Save draft
                  </Button>
                )}
                <Button
                  type="submit"
                  loading={saving}
                  disabled={
                    saving ||
                    specLoading ||
                    specProductId !== form.id_produk ||
                    spesifikasi.length === 0
                  }
                >
                  {saving ? "Saving…" : editingId ? "Save" : "Add"}
                </Button>
              </DialogFooter>
            </DomainForm>
          </DialogContent>
        </DomainDialog>
      </PageHeader>

      {canCreate && (
        <DraftPanel refresh={draftRefresh} onResume={resumeDraft} />
      )}
      <div>
        <FilterTabs
          label="Filter inspections"
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: "All results" },
            { value: "PASS", label: "Passed" },
            { value: "FAIL", label: "Failed" },
          ]}
        />
        <DataToolbar
          search={searchInput}
          onSearch={onSearchChange}
          placeholder="Search lots or products…"
          total={totalCount}
          loading={loading}
          onRefresh={() => void fetchData()}
          order={order}
          onOrder={setOrder}
        />
      </div>

      {/* Table card: hairline border, radius 8, header micro-labels on surface-alt */}
      <DataTools
        tableControlled
        module="inspeksi"
        search={search}
        filter={filter}
        order={order}
        filters={advanced}
        onFilters={setAdvanced}
        loading={loading}
      />
      <div className="data-card">
        <AdvancedRecordsTable
          state={table}
          context={{ ...advanced, order }}
          onContext={(v) => {
            setAdvanced({
              from: v.from || "",
              to: v.to || "",
              product: v.product || "",
              person: v.person || "",
              category: v.category || "",
            });
            if (["default", "newest", "oldest"].includes(v.order))
              setOrder(v.order);
          }}
          onRestore={(q, s) => {
            setSearchInput(q);
            setSearch(q);
            setFilter(s || "all");
          }}
          rows={data.map((r) => ({ ...r }))}
          search={search}
          status={filter}
          exportURL={
            "/api/export?" +
            new URLSearchParams({
              module: "inspeksi",
              search: search,
              filter: filter,
              order: order,
              ...advanced,
            })
          }
        >
          <Table data-actions>
            <TableHeader>
              <TableRow className="hover:bg-surface-alt">
                <TableHead className="pl-4">Lot number</TableHead>
                <TableHead>Products</TableHead>
                <TableHead className="text-right">Sampling date</TableHead>
                <TableHead className="text-right">Test date</TableHead>
                <TableHead>Inspector</TableHead>
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
              {!loading && !loadError && data.length === 0 && (
                <TableRow className="hover:bg-surface">
                  <TableCell colSpan={7} className="!p-0">
                    <div className="empty-state">
                      <div className="empty-icon">
                        <FlaskConical className="size-4" />
                      </div>
                      <p className="text-base font-semibold tracking-tight">
                        {search ||
                        filter !== "all" ||
                        Object.values(advanced).some(Boolean)
                          ? "No matching results"
                          : "NO TEST DATA"}
                      </p>
                      <p className="text-xs text-muted">
                        {search ||
                        filter !== "all" ||
                        Object.values(advanced).some(Boolean)
                          ? "Try another keyword or clear your filters."
                          : "Add your first record to get started."}
                      </p>
                      {!search &&
                        filter === "all" &&
                        !Object.values(advanced).some(Boolean) &&
                        canCreate && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              resetForm();
                              setDialogOpen(true);
                            }}
                          >
                            <Plus className="size-3.5" /> New inspection
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
                data.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => openDetail(row)}
                  >
                    <TableCell className="pl-4">
                      <div className="font-data">{row.no_lot}</div>
                    </TableCell>
                    <TableCell className="text-muted">
                      {row.master_produk?.nama_produk || "-"}
                    </TableCell>
                    <TableCell className="font-data text-right text-muted">
                      {row.tgl_sampling}
                    </TableCell>
                    <TableCell className="font-data text-right text-muted">
                      {row.tgl_uji}
                    </TableCell>
                    <TableCell>{row.inspector || "-"}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                      {row.superseded && (
                        <Badge variant="secondary">Superseded</Badge>
                      )}
                    </TableCell>
                    <TableCell
                      className="pr-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <RowActions>
                        <CopyValue value={row.no_lot} label="Copy lot number" />
                        <button
                          type="button"
                          className="row-action"
                          onClick={() => openDetail(row)}
                          title="Detail"
                        >
                          <Eye className="size-3.5" />
                        </button>
                        {canUpdate && !row.superseded && (
                          <button
                            type="button"
                            className="row-action"
                            onClick={() => openEdit(row)}
                            title="Edit"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        )}
                        {canDelete && !row.superseded && (
                          <button
                            type="button"
                            className="row-action"
                            data-tone="danger"
                            onClick={() => handleDelete(row.id)}
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
        </AdvancedRecordsTable>
      </div>

      {!loading && !loadError && data.length > 0 && (
        <DataPagination
          count={data.length}
          total={totalCount}
          loading={paging}
          page={Math.floor(offset / pageSize) + 1}
          pageSize={pageSize}
          onPageChange={(p) => void goToPage(p)}
        />
      )}

      {/* Detail dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="flex max-h-[90svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="gap-1 border-b border-border-soft px-6 py-4 pr-14">
            <p className="micro-label">INSPECTIONS</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">
              Inspection details
            </DialogTitle>
            <DialogDescription>
              Record the lot, observations, and test results.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {detailItem && (
              <div className="space-y-5">
                <div className="detail-metadata grid grid-cols-1 gap-5 rounded-xl border border-border-soft bg-surface-alt p-5 sm:grid-cols-2">
                  <div>
                    <span className="text-xs text-muted">Lot number</span>
                    <p className="font-data text-sm">{detailItem.no_lot}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted">Products</span>
                    <p className="text-sm font-medium">
                      {detailItem.master_produk?.nama_produk || "-"}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted">Sampling date</span>
                    <p className="font-data text-sm">
                      {detailItem.tgl_sampling}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted">Test date</span>
                    <p className="font-data text-sm">{detailItem.tgl_uji}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted">Inspector</span>
                    <p className="text-sm">{detailItem.inspector || "-"}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted">Status</span>
                    <p>
                      <StatusBadge status={detailItem.status} />
                      {detailItem.superseded && (
                        <Badge variant="secondary">Superseded inspection</Badge>
                      )}
                    </p>
                  </div>
                </div>

                {detailItem.failure_reason && (
                  <section className="fail-explanation">
                    <h3>Failure reason</h3>
                    <p>{detailItem.failure_reason}</p>
                  </section>
                )}
                {detailItem.spec_version && (
                  <p className="text-xs text-muted">
                    Specification version {detailItem.spec_version}
                  </p>
                )}
                {detailItem.catatan && (
                  <div className="border-t border-border-soft pt-4">
                    <span className="text-xs text-muted">Notes</span>
                    <p className="mt-1 text-sm">{detailItem.catatan}</p>
                  </div>
                )}

                {detailItem.hasil_detail?.length > 0 && (
                  <div className="border-t border-border-soft pt-4">
                    <p className="micro-label mb-3">Result details</p>
                    <ResultTable items={detailItem.hasil_detail} />
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="m-0 flex-row items-center justify-end gap-2 rounded-b-lg px-6 py-4">
            <DialogClose render={<Button variant="outline">Close</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
