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
import { inspectionSchema } from "@/lib/domain/validation";

import { businessDate, evaluateParam } from "@/lib/domain/validation";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "../../user-context";
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
  const confirm = useConfirm();
  const [filter, setFilter] = useState("all");
  const [order, setOrder] = useState("default");
  const requestSeq = useRef(0);
  const specSeq = useRef(0);
  const editSeq = useRef(0);
  const [specProductId, setSpecProductId] = useState<string | null>(null);
  const [specLoading, setSpecLoading] = useState(false);
  const appending = useRef(false);
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

  // Pagination: list queries are bounded with .range(); count:"exact" returns
  // the filtered row total (ignoring the range window) in the same request, so
  // "Muat lagi" knows how many rows are left without a second query.
  const [pageSize] = useState(50);
  const [offset, setOffset] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  // Which product the current hasilValues belong to. Values are kept only
  // while the selected product is unchanged; any product switch wipes them,
  // because parameter names collide across products and stale values would
  // be saved under the wrong product's parameters.

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
        .from("hasil_uji")
        .select("*, master_produk!inner(kode_produk, nama_produk)", {
          count: "exact",
        })
        .order("created_at", { ascending: order === "oldest" })
        .order("id")
        .range(start, start + pageSize - 1);
      if (filter !== "all") q = q.eq("status", filter);
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
        if (append) setLoadingMore(false);
        return;
      }
      if (error) {
        // A failed load-more keeps the accumulated rows and leaves the offset
        // unchanged, so retrying "Muat lagi" re-requests the same page.
        if (!append) {
          setLoadError(true);
          setData([]);
          setTotalCount(0);
        }
        toast.error("Gagal memuat data. Coba lagi.");
      } else {
        const rows = (raw as HasilUjiRow[]) ?? [];
        setLoadError(false);
        setData((prev) => (append ? [...prev, ...rows] : rows));
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

  const fetchProduk = useCallback(async () => {
    const { data, error } = await sb
      .from("master_produk")
      .select("*")
      .order("nama_produk");
    if (error) {
      setProdukList([]);
      toast.error("Gagal memuat data. Coba lagi.");
      return;
    }
    setProdukList((data as MasterProduk[]) ?? []);
  }, []);

  // Pure loader: only fills spesifikasi state, never touches hasilValues.
  const fetchSpesifikasi = useCallback(async (id_produk: string) => {
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
      toast.error("Gagal memuat data. Coba lagi.");
      setSpecLoading(false);
      return false;
    }
    setSpecProductId(id_produk);
    setSpecLoading(false);
    setSpesifikasi((data as SpesifikasiItem[]) ?? []);
    return true;
  }, []);

  useEffect(() => {
    const sequence = requestSeq;
    const timer = setTimeout(() => {
      void fetchData();
      void fetchProduk();
    }, 0);
    return () => {
      clearTimeout(timer);
      sequence.current++;
      appending.current = false;
    };
  }, [fetchData, fetchProduk]);

  // Clear the pending debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  function changeProduct(id: string) {
    editSeq.current++;
    setForm((prev) => ({ ...prev, id_produk: id }));
    setHasilValues({});
    void fetchSpesifikasi(id);
  }

  function onSearchChange(value: string) {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(value), 300);
  }

  function resetForm() {
    specSeq.current++;
    editSeq.current++;
    setSpecProductId(null);
    setSpecLoading(false);
    setForm({
      ...emptyForm,
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
      st: evaluateParam(sp, hasilValues[sp.parameter_uji] ?? ""),
    }));
  }

  async function handleSave() {
    if (
      specLoading ||
      specProductId !== form.id_produk ||
      spesifikasi.length === 0
    ) {
      toast.error(
        "Spesifikasi belum siap. Pilih produk dan tunggu pemuatan selesai.",
      );
      return;
    }
    if (!form.id_produk || !form.no_lot) {
      toast.error("Produk dan No Lot wajib diisi.");
      return;
    }
    setSaving(true);

    const detail = buildHasilDetail();
    const status = computeOverallStatus() ?? "FAIL";

    try {
      // Mutasi lewat server action: sesi + peran dicek server-side.
      const res = await saveInspeksiAction({
        id: editingId,
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
        toast.error(res.error ?? "Gagal menyimpan hasil uji. Coba lagi.");
        return;
      }
      toast.success(
        editingId ? "Hasil uji diperbarui." : "Hasil uji ditambahkan.",
      );
      setDialogOpen(false);
      resetForm();
      fetchData();
    } catch {
      toast.error("Gagal terhubung ke server. Coba lagi.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (
      !(await confirm({
        title: "Hapus hasil uji ini?",
        description:
          "Data yang dihapus tidak dapat dipulihkan melalui aplikasi. Pastikan data tidak lagi diperlukan.",
        confirmLabel: "Ya, hapus data",
      }))
    )
      return;

    // Server action: role check server-side.
    try {
      const res = await deleteInspeksiAction(id);
      if (!res.ok) {
        toast.error(res.error ?? "Gagal menghapus hasil uji. Coba lagi.");
        return;
      }
      toast.success("Hasil uji dihapus.");
      fetchData();
    } catch {
      toast.error("Gagal terhubung ke server. Coba lagi.");
    }
  }

  const role: UserRole = (user?.role as UserRole) ?? "viewer";
  const canDelete = canAction(role, "delete_uji");
  const canCreate = canAction(role, "create_uji");
  const canUpdate = canAction(role, "update_uji");
  const overallStatus = computeOverallStatus();

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Pengendalian mutu"
        title="Inspeksi"
        description="Hasil pengujian, parameter, dan status setiap lot."
      >
        <DomainDialog
          dirtyValue={{ form, hasilValues }}
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
                  <Plus className="size-4" /> Input Uji Baru
                </Button>
              }
            />
          )}

          <DialogContent className="flex max-h-[90svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
            <DialogHeader className="gap-1 border-b border-border-soft px-6 py-4 pr-14">
              <p className="micro-label">PENGUJIAN</p>
              <DialogTitle className="text-2xl font-semibold tracking-tight">
                {editingId ? "Edit Hasil Uji" : "Input Hasil Uji Baru"}
              </DialogTitle>
              <DialogDescription className="mt-2 text-xs leading-relaxed">
                Pilih produk, lengkapi informasi lot, lalu isi hasil untuk
                setiap parameter.
              </DialogDescription>
            </DialogHeader>
            <DomainForm
              value={{
                ...form,
                id: editingId,
                hasil_detail: buildHasilDetail(),
              }}
              schema={inspectionSchema}
              onSubmit={handleSave}
            >
              {/* Scrollable body; the footer stays pinned below it. */}
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <div className="space-y-6">
                  {/* Uji fields: two-column grid */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field
                      label="Produk *"
                      name="id_produk"
                      className="sm:col-span-2"
                      required
                    >
                      <select
                        className={selectClass}
                        value={form.id_produk}
                        onChange={(e) => changeProduct(e.target.value)}
                      >
                        <option value="">Pilih produk…</option>
                        {produkList.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.kode_produk} — {p.nama_produk}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="No Lot *" name="no_lot" required>
                      <Input
                        value={form.no_lot}
                        onChange={(e) =>
                          setForm({ ...form, no_lot: e.target.value })
                        }
                        placeholder="LOT-001"
                      />
                    </Field>
                    <Field label="Inspector" name="inspector" required>
                      <Input
                        value={form.inspector}
                        onChange={(e) =>
                          setForm({ ...form, inspector: e.target.value })
                        }
                        placeholder="Nama inspector"
                      />
                    </Field>
                    <Field label="Tgl Sampling" name="tgl_sampling" required>
                      <Input
                        type="date"
                        value={form.tgl_sampling}
                        onChange={(e) =>
                          setForm({ ...form, tgl_sampling: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Tgl Uji" name="tgl_uji" required>
                      <Input
                        type="date"
                        value={form.tgl_uji}
                        onChange={(e) =>
                          setForm({ ...form, tgl_uji: e.target.value })
                        }
                      />
                    </Field>
                  </div>

                  <Field label="Catatan" name="catatan">
                    <textarea
                      className={textareaClass}
                      value={form.catatan}
                      onChange={(e) =>
                        setForm({ ...form, catatan: e.target.value })
                      }
                      placeholder="Catatan (opsional)"
                    />
                  </Field>

                  {/* Dynamic hasil input */}
                  {spesifikasi.length > 0 && (
                    <div className="border-t border-border pt-5">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <span className="micro-label">Hasil Pengujian</span>
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
                                aria-label={`Hasil ${sp.parameter_uji}`}
                                inputMode={
                                  sp.tipe_batas === "TEXT" ? "text" : "decimal"
                                }
                                placeholder={
                                  sp.tipe_batas === "TEXT" ? "Nilai" : "0"
                                }
                                value={val}
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
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-4 flex items-center gap-2">
                        <span className="text-xs font-medium">
                          Status Final:
                        </span>
                        {overallStatus === null ? (
                          <Badge variant="secondary">Belum diisi</Badge>
                        ) : (
                          <StatusBadge status={overallStatus} />
                        )}
                      </div>
                    </div>
                  )}
                  {form.id_produk && spesifikasi.length === 0 && (
                    <p className="text-[13px] text-muted">
                      Produk ini belum memiliki spesifikasi pengujian.
                    </p>
                  )}
                </div>
              </div>

              <DialogFooter className="m-0 flex-row items-center justify-between gap-2 rounded-b-lg px-6 py-4 sm:justify-between">
                <DialogClose
                  render={<Button variant="outline">Batal</Button>}
                />
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
                  {saving ? "Menyimpan…" : editingId ? "Simpan" : "Tambah"}
                </Button>
              </DialogFooter>
            </DomainForm>
          </DialogContent>
        </DomainDialog>
      </PageHeader>

      <div>
        <FilterTabs
          label="Filter inspeksi"
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: "Semua hasil" },
            { value: "PASS", label: "Lulus / PASS" },
            { value: "FAIL", label: "Tidak lulus / FAIL" },
          ]}
        />
        <DataToolbar
          search={searchInput}
          onSearch={onSearchChange}
          placeholder="Cari no lot atau produk…"
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
              <TableHead className="pl-4">No Lot</TableHead>
              <TableHead>Produk</TableHead>
              <TableHead className="text-right">Tgl Sampling</TableHead>
              <TableHead className="text-right">Tgl Uji</TableHead>
              <TableHead>Inspector</TableHead>
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
            {!loading && !loadError && data.length === 0 && (
              <TableRow className="hover:bg-surface">
                <TableCell colSpan={7} className="!p-0">
                  <div className="empty-state">
                    <div className="empty-icon">
                      <FlaskConical className="size-4" />
                    </div>
                    <p className="text-base font-semibold tracking-tight">
                      {search || filter !== "all"
                        ? "Tidak ada hasil yang cocok"
                        : "TIDAK ADA DATA UJI"}
                    </p>
                    <p className="text-xs text-muted">
                      {search || filter !== "all"
                        ? "Coba kata kunci lain atau hapus pencarian Anda."
                        : "Mulai dengan menambahkan data pertama ke ruang kerja ini."}
                    </p>
                    {!search && filter === "all" && canCreate && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          resetForm();
                          setDialogOpen(true);
                        }}
                      >
                        <Plus className="size-3.5" /> Input Uji Baru
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
                  </TableCell>
                  <TableCell
                    className="pr-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="row-actions">
                      <button
                        type="button"
                        className="row-action"
                        onClick={() => openDetail(row)}
                        title="Detail"
                      >
                        <Eye className="size-3.5" />
                      </button>
                      {canUpdate && (
                        <button
                          type="button"
                          className="row-action"
                          onClick={() => openEdit(row)}
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

      {!loading && !loadError && data.length > 0 && (
        <DataPagination
          count={data.length}
          total={totalCount}
          loading={loadingMore}
          onMore={() => void loadMore()}
        />
      )}

      {/* Detail dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="flex max-h-[90svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="gap-1 border-b border-border-soft px-6 py-4 pr-14">
            <p className="micro-label">PENGUJIAN</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">
              Detail Hasil Uji
            </DialogTitle>
            <DialogDescription>
              Identitas lot, observasi, dan evaluasi terhadap standar pengujian.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {detailItem && (
              <div className="space-y-5">
                <div className="detail-metadata grid grid-cols-1 gap-5 rounded-xl border border-border-soft bg-surface-alt p-5 sm:grid-cols-2">
                  <div>
                    <span className="text-xs text-muted">No Lot</span>
                    <p className="font-data text-sm">{detailItem.no_lot}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted">Produk</span>
                    <p className="text-sm font-medium">
                      {detailItem.master_produk?.nama_produk || "-"}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted">Tgl Sampling</span>
                    <p className="font-data text-sm">
                      {detailItem.tgl_sampling}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted">Tgl Uji</span>
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
                    </p>
                  </div>
                </div>

                {detailItem.catatan && (
                  <div className="border-t border-border-soft pt-4">
                    <span className="text-xs text-muted">Catatan</span>
                    <p className="mt-1 text-sm">{detailItem.catatan}</p>
                  </div>
                )}

                {detailItem.hasil_detail?.length > 0 && (
                  <div className="border-t border-border-soft pt-4">
                    <p className="micro-label mb-3">Hasil Detail</p>
                    <ResultTable items={detailItem.hasil_detail} />
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="m-0 flex-row items-center justify-end gap-2 rounded-b-lg px-6 py-4">
            <DialogClose render={<Button variant="outline">Tutup</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
