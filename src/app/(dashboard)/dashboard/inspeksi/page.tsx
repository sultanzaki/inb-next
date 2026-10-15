"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "../../user-context";
import { canAction } from "@/lib/types";
import type {
  HasilUjiItem,
  HasilUjiRow,
  MasterProduk,
  SpesifikasiItem,
  UserRole,
} from "@/lib/types";
import { toast } from "sonner";
import { saveInspeksiAction, deleteInspeksiAction } from "@/lib/actions/inspeksi-actions";
import { Search, Plus, Pencil, Trash2, Eye, FlaskConical } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";

// Module-level browser client: a single instance instead of one per render.
const sb = createClient();

// Monotonic counter used to ignore stale list-fetch responses.
let requestSeq = 0;

// Monotonic counter used to ignore stale spesifikasi fetches (openEdit race,
// rapid product switches).
let specSeq = 0;

// Monotonic counter used to ignore stale openEdit resolutions (clicking
// Edit(A) then Edit(B), or opening the new-form dialog, while A is in flight).
let editSeq = 0;

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

function evaluateParam(sp: SpesifikasiItem, val: string): "PASS" | "FAIL" {
  if (!val) return "FAIL";
  if (sp.tipe_batas === "TEXT") return "PASS";
  const num = parseFloat(val);
  if (isNaN(num)) return "FAIL";
  const min = sp.nilai_min ? parseFloat(sp.nilai_min) : -Infinity;
  const max = sp.nilai_maks ? parseFloat(sp.nilai_maks) : Infinity;
  if (sp.tipe_batas === "MIN" && num >= min) return "PASS";
  if (sp.tipe_batas === "MAX" && num <= max) return "PASS";
  if (sp.tipe_batas === "RANGE" && num >= min && num <= max) return "PASS";
  return "FAIL";
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
  tgl_sampling: new Date().toISOString().split("T")[0],
  tgl_uji: new Date().toISOString().split("T")[0],
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
  const valuesProductIdRef = useRef<string | null>(null);

  // Bounded query runner shared by the fresh fetch and load-more.
  // append=false swaps the accumulated list (mount, search, retry, after a
  // mutation); append=true fetches the page starting at `start` and appends.
  const runQuery = useCallback(
    async (start: number, append: boolean) => {
      const seq = ++requestSeq;
      if (append) setLoadingMore(true);
      else setLoading(true);
      let q = sb
        .from("hasil_uji")
        .select("*, master_produk!inner(kode_produk, nama_produk)", {
          count: "exact",
        })
        .order("created_at", { ascending: false })
        .range(start, start + pageSize - 1);
      if (search) {
        // Quoted values (via escapeOr): commas/parens stay literal and the
        // escaped %/_ reach Postgres LIKE as literals, not wildcards.
        const term = escapeOr(search);
        q = q.or(
          `no_lot.ilike."%${term}%",master_produk.nama_produk.ilike."%${term}%"`
        );
      }
      const { data: raw, count, error } = await q;
      if (seq !== requestSeq) {
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
        if (append) setOffset(start + rows.length);
      }
      if (append) setLoadingMore(false);
      else setLoading(false);
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
    const seq = ++specSeq;
    if (!id_produk) {
      setSpesifikasi([]);
      return;
    }
    const { data, error } = await sb
      .from("spesifikasi")
      .select("*")
      .eq("id_produk", id_produk)
      .order("urutan");
    if (seq !== specSeq) return; // superseded by a newer fetch
    if (error) {
      setSpesifikasi([]);
      toast.error("Gagal memuat data. Coba lagi.");
      return;
    }
    setSpesifikasi((data as SpesifikasiItem[]) ?? []);
  }, []);

  useEffect(() => {
    fetchData();
    fetchProduk();
  }, [fetchData, fetchProduk]);

  // Clear the pending debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  useEffect(() => {
    fetchSpesifikasi(form.id_produk);
    // Keep hasil values only while they belong to the currently selected
    // product. On any product change — fresh form or a product switch while
    // editing — wipe them: parameter names collide across products, so
    // retaining values would prefill/save them under the wrong parameters.
    if (form.id_produk !== valuesProductIdRef.current) {
      setHasilValues({});
    }
  }, [form.id_produk, fetchSpesifikasi]);

  function onSearchChange(value: string) {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(value), 300);
  }

  function resetForm() {
    setForm(emptyForm);
    setSpesifikasi([]);
    setHasilValues({});
    setEditingId(null);
  }

  async function openEdit(item: HasilUjiRow) {
    const seq = ++editSeq;
    setEditingId(item.id);
    valuesProductIdRef.current = item.id_produk;
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
    await fetchSpesifikasi(item.id_produk);

    // A newer Edit click (or a new-form dialog open) superseded this one;
    // applying A's resolved values under B's form would corrupt row B on save.
    if (seq !== editSeq) return;

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
      (sp) => (hasilValues[sp.parameter_uji] ?? "") !== ""
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
      toast.success(editingId ? "Hasil uji diperbarui." : "Hasil uji ditambahkan.");
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
    if (!confirm("Hapus hasil uji ini?")) return;

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
    <div className="space-y-6">
      {/* Page header: micro-label + title left, primary action right */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="micro-label">PENGUJIAN</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Inspeksi</h1>
          <p className="mt-1 text-[13px] text-muted">
            Kelola data pengujian dan inspeksi produk.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(v) => { if (v) editSeq++; setDialogOpen(v); if (!v) resetForm(); }}>
          {canCreate && (
            <DialogTrigger render={<Button><Plus className="size-4" /> Input Uji Baru</Button>} />
          )}

          <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
            <DialogHeader className="gap-1 border-b border-border-soft px-6 py-4 pr-14">
              <p className="micro-label">PENGUJIAN</p>
              <DialogTitle className="text-2xl font-semibold tracking-tight">
                {editingId ? "Edit Hasil Uji" : "Input Hasil Uji Baru"}
              </DialogTitle>
            </DialogHeader>

            {/* Scrollable body; the footer stays pinned below it. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="space-y-6">
                {/* Uji fields: two-column grid */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-xs font-medium">Produk *</label>
                    <select
                      className={selectClass}
                      value={form.id_produk}
                      onChange={(e) => setForm({ ...form, id_produk: e.target.value })}
                    >
                      <option value="">Pilih produk…</option>
                      {produkList.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.kode_produk} — {p.nama_produk}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">No Lot *</label>
                    <Input
                      value={form.no_lot}
                      onChange={(e) => setForm({ ...form, no_lot: e.target.value })}
                      placeholder="LOT-001"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Inspector</label>
                    <Input
                      value={form.inspector}
                      onChange={(e) => setForm({ ...form, inspector: e.target.value })}
                      placeholder="Nama inspector"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Tgl Sampling</label>
                    <Input
                      type="date"
                      value={form.tgl_sampling}
                      onChange={(e) => setForm({ ...form, tgl_sampling: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Tgl Uji</label>
                    <Input
                      type="date"
                      value={form.tgl_uji}
                      onChange={(e) => setForm({ ...form, tgl_uji: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Catatan</label>
                  <textarea
                    className={textareaClass}
                    value={form.catatan}
                    onChange={(e) => setForm({ ...form, catatan: e.target.value })}
                    placeholder="Catatan (opsional)"
                  />
                </div>

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
                          <div
                            key={sp.id}
                            className="flex items-center gap-3 rounded-md border border-border bg-surface-alt p-3"
                          >
                            <div className="min-w-0 flex-1">
                              <span className="text-sm font-medium">
                                {sp.parameter_uji}
                              </span>
                              {sp.tipe_batas !== "TEXT" && (
                                <span className="font-data ml-2 text-[11px] text-faint">
                                  ({sp.tipe_batas}: {sp.nilai_min}
                                  {sp.tipe_batas === "RANGE" && ` — ${sp.nilai_maks}`}
                                  {sp.satuan && ` ${sp.satuan}`})
                                </span>
                              )}
                            </div>
                            <Input
                              className="w-28"
                              placeholder={sp.tipe_batas === "TEXT" ? "Nilai" : "0"}
                              value={val}
                              onChange={(e) => {
                                valuesProductIdRef.current = form.id_produk;
                                setHasilValues({
                                  ...hasilValues,
                                  [sp.parameter_uji]: e.target.value,
                                });
                              }}
                            />
                            {res && (
                              <Badge
                                variant={res === "PASS" ? "default" : "destructive"}
                              >
                                {res}
                              </Badge>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-4 flex items-center gap-2">
                      <span className="text-xs font-medium">Status Final:</span>
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
              <DialogClose render={<Button variant="outline">Batal</Button>} />
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Menyimpan…" : editingId ? "Simpan" : "Tambah"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Toolbar: search left, result meta right */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-60 max-w-full">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input
            placeholder="Cari no lot atau produk…"
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8"
          />
        </div>
        <p className="shrink-0 text-[13px] text-muted">
          <span className="font-data text-text">{data.length}</span> dari{" "}
          <span className="font-data text-text">{totalCount}</span> data
        </p>
      </div>

      {/* Table card: hairline border, radius 8, header micro-labels on surface-alt */}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <Table>
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
            {!loading && !loadError && data.length === 0 && (
              <TableRow className="hover:bg-surface">
                <TableCell colSpan={7} className="px-4 py-12">
                  <div className="flex flex-col items-center gap-4 text-center">
                    <div className="flex size-10 items-center justify-center rounded-full border border-border text-faint">
                      <FlaskConical className="size-4" />
                    </div>
                    <p className="micro-label">
                      {search ? "TIDAK ADA HASIL" : "TIDAK ADA DATA UJI"}
                    </p>
                    {!search && canCreate && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDialogOpen(true)}
                      >
                        <Plus className="size-3.5" /> Input Uji Baru
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
                <TableCell className="pr-4" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    <button
                      className="rounded-md p-1.5 text-muted outline-none transition-colors duration-150 hover:bg-surface-alt hover:text-text focus-visible:ring-2 focus-visible:ring-primary/30"
                      onClick={() => openDetail(row)}
                      title="Detail"
                    >
                      <Eye className="size-3.5" />
                    </button>
                    {canUpdate && (
                      <button
                        className="rounded-md p-1.5 text-muted outline-none transition-colors duration-150 hover:bg-surface-alt hover:text-text focus-visible:ring-2 focus-visible:ring-primary/30"
                        onClick={() => openEdit(row)}
                        title="Edit"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        className="rounded-md p-1.5 text-danger outline-none transition-colors duration-150 hover:bg-danger-bg focus-visible:ring-2 focus-visible:ring-danger/20"
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

      {/* Pagination: load-more + counter */}
      {!loading && !loadError && data.length > 0 && (
        <div className="space-y-3">
          {data.length < totalCount && (
            <Button
              variant="outline"
              className="w-full"
              disabled={loadingMore}
              onClick={() => loadMore()}
            >
              {loadingMore
                ? "Memuat…"
                : `Muat lagi (${totalCount - data.length} tersisa)`}
            </Button>
          )}
          <p className="text-center text-[13px] text-muted">
            Menampilkan <span className="font-data text-text">{data.length}</span> dari{" "}
            <span className="font-data text-text">{totalCount}</span> data
          </p>
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="gap-1 border-b border-border-soft px-6 py-4 pr-14">
            <p className="micro-label">PENGUJIAN</p>
            <DialogTitle className="text-2xl font-semibold tracking-tight">
              Detail Hasil Uji
            </DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {detailItem && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
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
                    <p className="font-data text-sm">{detailItem.tgl_sampling}</p>
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
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Parameter</th>
                          <th className="py-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Nilai</th>
                          <th className="py-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailItem.hasil_detail.map((h: HasilUjiItem, i: number) => (
                          <tr key={i} className="border-b border-border-soft last:border-0">
                            <td className="py-2">{h.p}</td>
                            <td className="font-data py-2 text-right">{h.val}</td>
                            <td className="py-2 text-right">
                              <span className={`font-data ${h.st === "PASS" ? "text-success-dark" : "text-danger-dark"}`}>{h.st}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
