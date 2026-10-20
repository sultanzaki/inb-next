"use client";
import Link from "next/link";
import { useERP } from "@/components/erp/context";
import { SpecificationParameters } from "@/components/workspace/specification-parameters";
import { RowActions } from "@/components/workspace/row-actions";
import { SpecHistory } from "@/components/workspace/spec-history";
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
import { useConfirm } from "@/components/workspace/confirm-provider";
import { productSchema } from "@/lib/domain/validation";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/app/(dashboard)/user-context";
import { canAction } from "@/lib/types";
import type { MasterProduk, SpesifikasiItem, UserRole } from "@/lib/types";
import { toast } from "sonner";
import {
  saveProdukAction,
  deleteProdukAction,
} from "@/lib/actions/produk-actions";
import { Plus, Pencil, Trash2, PackageSearch, Eye } from "lucide-react";
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
import { escapeOrTerm } from "@/lib/filter-utils";

// Module-level browser client: a single instance instead of one per render.
const sb = createClient();

// Monotonic counter used to ignore stale list-fetch responses.

const kategoriList = [
  "Raw materials",
  "Finished goods",
  "Packaging materials",
  "Additives",
];
const satuanList = [
  "Kg",
  "Gram",
  "Liter",
  "mL",
  "Unit",
  "Bottle",
  "Sachet",
  "Box",
];
const kemasanList = [
  "Bottle",
  "Sachet",
  "Box",
  "Jerry can",
  "Drum",
  "Pouch",
  "Other",
];

interface SpesifikasiForm {
  parameter_en: string;
  keterangan_en: string;
  parameter_uji: string;
  tipe_batas: "RANGE" | "MIN" | "MAX" | "TEXT";
  nilai_min: string;
  nilai_maks: string;
  satuan: string;
  keterangan: string;
}

interface ProdukForm {
  inci_name: string;
  nama_produk_en: string;
  revision_note: string;
  kode_produk: string;
  nama_produk: string;
  kategori: string;
  satuan: string;
  status_halal: string;
  tipe_kemasan: string;
}

const emptyForm: ProdukForm = {
  inci_name: "",
  nama_produk_en: "",
  revision_note: "",
  kode_produk: "",
  nama_produk: "",
  kategori: "",
  satuan: "",
  status_halal: "Halal",
  tipe_kemasan: "",
};

// Status is always a dot-chip: emerald tint for Halal, danger tint otherwise.
function statusHalalBadge(val: string) {
  if (val === "Halal") return <Badge>Halal</Badge>;
  return <Badge variant="destructive">Non-Halal</Badge>;
}

// Native select styled to match the Input kit (hairline border, 36px, 6px
// radius); focus border + ring come from the global input/select rule.
const selectClass =
  "h-9 w-full rounded-md border border-input bg-surface px-2.5 text-sm transition-colors duration-150 outline-none";

export default function ProdukPage() {
  const confirm = useConfirm();
  const erp = useERP();
  const [filter, setFilter] = useState("all");
  const [order, setOrder] = useState("default");
  const [advanced, setAdvanced] = useState<AdvancedFilters>({
    ...emptyFilters,
  });
  useSearchSeed(onSearchChange);
  const requestSeq = useRef(0);
  const editSeq = useRef(0);
  const detailSeq = useRef(0);
  const [detail, setDetail] = useState<MasterProduk | null>(null);
  const [detailSpecs, setDetailSpecs] = useState<SpesifikasiItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const navigating = useRef(false);
  const { user } = useUser();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [produkList, setProdukList] = useState<MasterProduk[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProdukForm>(emptyForm);
  const [spesifikasi, setSpesifikasi] = useState<SpesifikasiForm[]>([]);
  const [saving, setSaving] = useState(false);

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
        .from("master_produk")
        .select("*", { count: "exact" })
        .order(order === "default" ? "nama_produk" : "created_at", {
          ascending: order !== "newest",
        })
        .order("id")
        .range(start, start + pageSize - 1);
      if (filter !== "all") q = q.eq("status_halal", filter);
      if (advanced.from)
        q = q.gte("created_at", advanced.from + "T00:00:00+07:00");
      if (advanced.to)
        q = q.lte("created_at", advanced.to + "T23:59:59.999999+07:00");
      if (advanced.category) q = q.eq("kategori", advanced.category);
      if (search) {
        // Quoted values (via escapeOrTerm): commas/parens stay literal and the
        // escaped %/_ reach Postgres LIKE as literals, not wildcards.
        const term = escapeOrTerm(search);
        q = q.or(`nama_produk.ilike."%${term}%",kode_produk.ilike."%${term}%"`);
      }
      const { data, count, error } = await q;
      if (seq !== requestSeq.current) {
        // Superseded by a newer request: release the loading flag this
        // request owned (the newer one manages its own).
        if (pageRequest) setPaging(false);
        return;
      }
      if (error) {
        if (!pageRequest) {
          setLoadError(true);
          setProdukList([]);
          setTotalCount(0);
        }
        toast.error("Could not load data. Retry.");
      } else {
        const rows = (data as MasterProduk[]) ?? [];
        setLoadError(false);
        setProdukList(rows);
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

  useEffect(() => {
    const sequence = requestSeq;
    const timer = setTimeout(() => {
      void fetchData();
    }, 0);
    return () => {
      clearTimeout(timer);
      sequence.current++;
      navigating.current = false;
    };
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
    editSeq.current++;
    setForm(emptyForm);
    setSpesifikasi([]);
    setEditingId(null);
  }

  async function openEdit(produk: MasterProduk) {
    const seq = ++editSeq.current;
    // Load spesifikasi first: if it fails, don't open the edit dialog at all
    // (saving from a dialog with an empty spec list would wipe real rows).
    const { data: sp, error: spErr } = await sb
      .from("spesifikasi")
      .select("*")
      .eq("id_produk", produk.id)
      .order("urutan");
    if (seq !== editSeq.current) return;
    if (spErr) {
      toast.error("Could not load data. Retry.");
      return;
    }

    setForm({
      inci_name: produk.inci_name || "",
      nama_produk_en: produk.nama_produk_en || "",
      revision_note: "",
      kode_produk: produk.kode_produk,
      nama_produk: produk.nama_produk,
      kategori: produk.kategori,
      satuan: produk.satuan,
      status_halal: produk.status_halal,
      tipe_kemasan: produk.tipe_kemasan,
    });
    setEditingId(produk.id);

    setSpesifikasi(
      (sp ?? []).map((s: SpesifikasiItem) => ({
        parameter_uji: s.parameter_uji,
        parameter_en: s.parameter_en || "",
        keterangan_en: s.keterangan_en || "",
        tipe_batas: s.tipe_batas,
        nilai_min: s.nilai_min ?? "",
        nilai_maks: s.nilai_maks ?? "",
        satuan: s.satuan ?? "",
        keterangan: s.keterangan ?? "",
      })),
    );
    setDialogOpen(true);
  }

  async function openDetail(produk: MasterProduk) {
    const seq = ++detailSeq.current;
    setDetail(produk);
    setDetailSpecs([]);
    setDetailLoading(true);
    setDetailError(false);
    const { data, error } = await sb
      .from("spesifikasi")
      .select("*")
      .eq("id_produk", produk.id)
      .order("urutan");
    if (seq !== detailSeq.current) return;
    setDetailSpecs((data ?? []) as SpesifikasiItem[]);
    setDetailError(Boolean(error));
    setDetailLoading(false);
  }

  function addSpesifikasiRow() {
    setSpesifikasi((prev) => [
      ...prev,
      {
        parameter_uji: "",
        parameter_en: "",
        keterangan_en: "",
        tipe_batas: "RANGE",
        nilai_min: "",
        nilai_maks: "",
        satuan: "",
        keterangan: "",
      },
    ]);
  }

  function updateSpesifikasi(
    idx: number,
    field: keyof SpesifikasiForm,
    value: string,
  ) {
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
      toast.error("Product code and name are required.");
      return;
    }
    setSaving(true);
    try {
      // Mutasi lewat server action: sesi + peran dicek server-side.
      const res = await saveProdukAction({
        id: editingId,
        ...form,
        spesifikasi,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Could not save the product. Retry.");
        return;
      }
      toast.success(editingId ? "Product updated." : "Product added.");
      setDialogOpen(false);
      resetForm();
      fetchData();
    } catch {
      // Transport error (mis. jaringan putus): server action melempar, bukan
      // mengembalikan { ok:false } — tanpa catch user tidak lihat apa pun.
      toast.error("Could not reach the server. Retry.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (
      !(await confirm({
        title: "Delete this product and its specifications?",
        description: "This cannot be undone.",
        confirmLabel: "Delete record",
      }))
    )
      return;

    // Server action: pre-check COA/hasil uji + role check server-side.
    try {
      const res = await deleteProdukAction(id);
      if (!res.ok) {
        toast.error(res.error ?? "Could not delete the product. Retry.");
        return;
      }
      toast.success("Product deleted.");
      fetchData();
    } catch {
      // transport error — action tetap { ok:false } untuk kegagalan aplikatif;
      // tanpa catch user tidak lihat apa pun.
      toast.error("Could not reach the server. Retry.");
    }
  }

  const role: UserRole = (user?.role as UserRole) ?? "viewer";
  const canDelete = canAction(user || role, "delete_produk");
  const canCreate = canAction(user || role, "create_produk");
  const canUpdate = canAction(user || role, "update_produk");

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Master data"
        title="Products"
        description="Product catalog and test specifications."
      >
        <DomainDialog
          dirtyValue={{ form, spesifikasi }}
          busy={saving}
          open={dialogOpen}
          onOpenChange={(v) => {
            setDialogOpen(v);
            if (!v) resetForm();
          }}
        >
          {canCreate && (
            <DialogTrigger
              render={
                <Button>
                  <Plus className="size-4" /> New product
                </Button>
              }
            />
          )}

          <DialogContent className="flex max-h-[90svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
            <DialogHeader className="gap-1 border-b border-border-soft px-6 py-4 pr-14">
              <p className="micro-label">MASTER DATA</p>
              <DialogTitle className="text-2xl font-semibold tracking-tight">
                {editingId ? "Edit product" : "New product"}
              </DialogTitle>
              <DialogDescription className="mt-2 text-xs leading-relaxed">
                Set the product details and inspection specifications.
              </DialogDescription>
            </DialogHeader>
            <DomainForm
              value={{ ...form, id: editingId, spesifikasi }}
              schema={productSchema}
              onSubmit={handleSave}
            >
              {/* Scrollable body; the footer stays pinned below it. */}
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <div className="space-y-6">
                  {/* Produk fields: two-column grid */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Product code *" name="kode_produk" required>
                      <Input
                        value={form.kode_produk}
                        onChange={(e) =>
                          setForm({ ...form, kode_produk: e.target.value })
                        }
                        placeholder="PRD-001"
                      />
                    </Field>
                    <Field label="Product name *" name="nama_produk" required>
                      <Input
                        value={form.nama_produk}
                        onChange={(e) =>
                          setForm({ ...form, nama_produk: e.target.value })
                        }
                        placeholder="Product name"
                      />
                    </Field>
                    <Field
                      label="INCI name"
                      name="inci_name"
                      hint="Used on the certificate."
                    >
                      <Input
                        value={form.inci_name}
                        onChange={(e) =>
                          setForm({ ...form, inci_name: e.target.value })
                        }
                      />
                    </Field>
                    <Field
                      label="Product name in English"
                      name="nama_produk_en"
                      hint="Optional if the trade name is the same."
                    >
                      <Input
                        value={form.nama_produk_en}
                        onChange={(e) =>
                          setForm({ ...form, nama_produk_en: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Category" name="kategori">
                      <select
                        className={selectClass}
                        value={form.kategori}
                        onChange={(e) =>
                          setForm({ ...form, kategori: e.target.value })
                        }
                      >
                        <option value="">Select…</option>
                        {kategoriList.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Unit" name="satuan">
                      <select
                        className={selectClass}
                        value={form.satuan}
                        onChange={(e) =>
                          setForm({ ...form, satuan: e.target.value })
                        }
                      >
                        <option value="">Select…</option>
                        {satuanList.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Halal status" name="status_halal">
                      <select
                        className={selectClass}
                        value={form.status_halal}
                        onChange={(e) =>
                          setForm({ ...form, status_halal: e.target.value })
                        }
                      >
                        <option value="Halal">Halal</option>
                        <option value="Non-Halal">Non-Halal</option>
                      </select>
                    </Field>
                    <Field label="Packaging type" name="tipe_kemasan">
                      <select
                        className={selectClass}
                        value={form.tipe_kemasan}
                        onChange={(e) =>
                          setForm({ ...form, tipe_kemasan: e.target.value })
                        }
                      >
                        <option value="">Select…</option>
                        {kemasanList.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  {editingId && (
                    <Field label="Revision note" name="revision_note">
                      <Input
                        value={form.revision_note}
                        onChange={(e) =>
                          setForm({ ...form, revision_note: e.target.value })
                        }
                        placeholder="Reason for this revision"
                      />
                    </Field>
                  )}
                  {/* Spesifikasi section */}
                  <div className="border-t border-border pt-5">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <span className="micro-label">Test specifications</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={addSpesifikasiRow}
                      >
                        <Plus className="size-3.5" /> Add parameter
                      </Button>
                    </div>

                    {spesifikasi.length === 0 && (
                      <p className="text-[13px] text-muted">
                        No parameters yet. Select &ldquo;Add parameter&rdquo; to
                        begin.
                      </p>
                    )}

                    <div className="space-y-2">
                      {spesifikasi.map((sp, idx) => (
                        <div
                          key={idx}
                          className="parameter-card flex items-start gap-3"
                        >
                          <div className="parameter-grid min-w-0 flex-1">
                            <Field
                              label="Parameter"
                              name={`spesifikasi.${idx}.parameter_uji`}
                              required
                            >
                              <Input
                                value={sp.parameter_uji}
                                onChange={(e) =>
                                  updateSpesifikasi(
                                    idx,
                                    "parameter_uji",
                                    e.target.value,
                                  )
                                }
                                placeholder="Parameter"
                              />
                            </Field>
                            <Field
                              label="Type"
                              name={`spesifikasi.${idx}.tipe_batas`}
                            >
                              <select
                                className="h-8 w-full rounded-md border border-input bg-surface px-2 text-xs transition-colors duration-150 outline-none"
                                value={sp.tipe_batas}
                                onChange={(e) =>
                                  updateSpesifikasi(
                                    idx,
                                    "tipe_batas",
                                    e.target.value,
                                  )
                                }
                              >
                                <option value="RANGE">RANGE</option>
                                <option value="MIN">MIN</option>
                                <option value="MAX">MAX</option>
                                <option value="TEXT">TEXT</option>
                              </select>
                            </Field>
                            <Field
                              label="Min"
                              name={`spesifikasi.${idx}.nilai_min`}
                            >
                              <Input
                                disabled={
                                  sp.tipe_batas === "TEXT" ||
                                  sp.tipe_batas === "MAX"
                                }
                                numberFormat="raw"
                                inputMode="decimal"
                                value={sp.nilai_min}
                                onChange={(e) =>
                                  updateSpesifikasi(
                                    idx,
                                    "nilai_min",
                                    e.target.value,
                                  )
                                }
                                placeholder="Min"
                              />
                            </Field>
                            <Field
                              label="Max"
                              name={`spesifikasi.${idx}.nilai_maks`}
                            >
                              <Input
                                disabled={
                                  sp.tipe_batas === "TEXT" ||
                                  sp.tipe_batas === "MIN"
                                }
                                numberFormat="raw"
                                inputMode="decimal"
                                value={sp.nilai_maks}
                                onChange={(e) =>
                                  updateSpesifikasi(
                                    idx,
                                    "nilai_maks",
                                    e.target.value,
                                  )
                                }
                                placeholder="Max"
                              />
                            </Field>
                            <Field
                              label="Unit"
                              name={`spesifikasi.${idx}.satuan`}
                            >
                              <Input
                                value={sp.satuan}
                                onChange={(e) =>
                                  updateSpesifikasi(
                                    idx,
                                    "satuan",
                                    e.target.value,
                                  )
                                }
                                placeholder="Unit"
                              />
                            </Field>
                            <Field
                              label="Parameter in English"
                              name={`spesifikasi.${idx}.parameter_en`}
                            >
                              <Input
                                value={sp.parameter_en}
                                onChange={(e) =>
                                  updateSpesifikasi(
                                    idx,
                                    "parameter_en",
                                    e.target.value,
                                  )
                                }
                              />
                            </Field>
                            <Field
                              label="Observation standard"
                              name={`spesifikasi.${idx}.keterangan`}
                              hint="For text parameters."
                            >
                              <Input
                                value={sp.keterangan}
                                onChange={(e) =>
                                  updateSpesifikasi(
                                    idx,
                                    "keterangan",
                                    e.target.value,
                                  )
                                }
                              />
                            </Field>
                            <Field
                              label="Observation standard in English"
                              name={`spesifikasi.${idx}.keterangan_en`}
                            >
                              <Input
                                value={sp.keterangan_en}
                                onChange={(e) =>
                                  updateSpesifikasi(
                                    idx,
                                    "keterangan_en",
                                    e.target.value,
                                  )
                                }
                              />
                            </Field>
                          </div>
                          <button
                            type="button"
                            className="row-action mt-6 shrink-0"
                            data-tone="danger"
                            onClick={() => removeSpesifikasi(idx)}
                            title="Delete"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <DialogFooter className="m-0 flex-row items-center justify-between gap-2 rounded-b-lg px-6 py-4 sm:justify-between">
                <DialogClose
                  render={<Button variant="outline">Cancel</Button>}
                />
                <Button type="submit" loading={saving} disabled={saving}>
                  {saving ? "Saving…" : editingId ? "Save" : "Add"}
                </Button>
              </DialogFooter>
            </DomainForm>
          </DialogContent>
        </DomainDialog>
      </PageHeader>

      <div>
        <FilterTabs
          label="Filter products"
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: "All products" },
            { value: "Halal", label: "Halal" },
            { value: "Non-Halal", label: "Non-Halal" },
          ]}
        />
        <DataToolbar
          search={searchInput}
          onSearch={onSearchChange}
          placeholder="Search products…"
          total={totalCount}
          loading={loading}
          onRefresh={() => void fetchData()}
          order={order}
          onOrder={setOrder}
        />
      </div>

      {/* Table card: hairline border, radius 8, header micro-labels on surface-alt */}
      <DataTools
        module="produk"
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
              <TableHead className="pl-4">Products</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Halal</TableHead>
              <TableHead>Packaging</TableHead>
              <TableHead className="pr-4">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableSkeleton rows={5} cols={6} />}
            {!loading && loadError && (
              <TableRow>
                <TableCell colSpan={6} className="!p-0">
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
            {!loading && !loadError && produkList.length === 0 && (
              <TableRow className="hover:bg-surface">
                <TableCell colSpan={6} className="!p-0">
                  <div className="empty-state">
                    <div className="empty-icon">
                      <PackageSearch className="size-4" />
                    </div>
                    <p className="text-base font-semibold tracking-tight">
                      {search ||
                      filter !== "all" ||
                      Object.values(advanced).some(Boolean)
                        ? "No matching results"
                        : "No products yet"}
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
                          onClick={() => setDialogOpen(true)}
                        >
                          <Plus className="size-3.5" /> New product
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
              produkList.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="pl-4">
                    <button
                      type="button"
                      className="entity-name text-left hover:text-primary"
                      onClick={() => void openDetail(p)}
                    >
                      {p.nama_produk}
                    </button>
                    <div className="font-data text-xs text-muted">
                      {p.kode_produk}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted">{p.kategori}</TableCell>
                  <TableCell>{p.satuan}</TableCell>
                  <TableCell>{statusHalalBadge(p.status_halal)}</TableCell>
                  <TableCell className="text-muted">{p.tipe_kemasan}</TableCell>
                  <TableCell className="pr-4">
                    <RowActions>
                      <CopyValue
                        value={p.kode_produk}
                        label="Copy product code"
                      />
                      <button
                        type="button"
                        className="row-action"
                        onClick={() => void openDetail(p)}
                        title="Product details"
                      >
                        <Eye className="size-3.5" />
                      </button>
                      {canUpdate && (
                        <button
                          type="button"
                          className="row-action"
                          onClick={() => openEdit(p)}
                          title="Edit"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          className="row-action"
                          data-tone="danger"
                          onClick={() => handleDelete(p.id)}
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

      <Dialog
        open={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open) {
            detailSeq.current++;
            setDetail(null);
          }
        }}
      >
        <DialogContent className="product-detail-dialog max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <p className="micro-label">Product specifications</p>
            <DialogTitle>{detail?.nama_produk}</DialogTitle>
            <DialogDescription>
              {detail?.kode_produk} · Version {detail?.spec_version || 1} ·
              Current test specifications.
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <>
              <dl className="my-6 grid grid-cols-2 gap-5 rounded-xl border border-border-soft bg-surface-alt p-5">
                {[
                  ["Category", detail.kategori],
                  ["Unit", detail.satuan],
                  ["Halal status", detail.status_halal],
                  ["Packaging", detail.tipe_kemasan],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="micro-label">{label}</dt>
                    <dd className="mt-2 text-sm font-medium">{value || "—"}</dd>
                  </div>
                ))}
              </dl>
              {erp.can("documents") && (
                <Link
                  className="erp-document-link mb-5"
                  href={`/dashboard/product-documents?product=${detail.id}`}
                >
                  View product documents
                </Link>
              )}
              <h3 className="mb-3 text-sm font-semibold">Test parameters</h3>
              {detailLoading ? (
                <p
                  role="status"
                  className="py-8 text-center text-sm text-muted"
                >
                  Loading specifications…
                </p>
              ) : detailError ? (
                <EmptyState
                  error
                  title="Could not load specifications"
                  description="Reload to view this product's specifications."
                >
                  <Button
                    variant="outline"
                    onClick={() => void openDetail(detail)}
                  >
                    Retry
                  </Button>
                </EmptyState>
              ) : detailSpecs.length === 0 ? (
                <p className="rounded-xl bg-surface-alt p-5 text-sm text-muted">
                  This product has no test parameters.
                </p>
              ) : (
                <SpecificationParameters items={detailSpecs} />
              )}
              <SpecHistory
                key={detail.id}
                productId={detail.id}
                current={detailSpecs}
              />
            </>
          )}
          <DialogFooter className="mt-6">
            <DialogClose render={<Button variant="outline">Close</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {!loading && !loadError && produkList.length > 0 && (
        <DataPagination
          count={produkList.length}
          total={totalCount}
          loading={paging}
          page={Math.floor(offset / pageSize) + 1}
          pageSize={pageSize}
          onPageChange={(p) => void goToPage(p)}
        />
      )}
    </div>
  );
}
