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
import { useConfirm } from "@/components/workspace/confirm-provider";
import { productSchema } from "@/lib/domain/validation";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "../../user-context";
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
  "Bahan Baku",
  "Produk Jadi",
  "Bahan Kemas",
  "Bahan Tambahan",
];
const satuanList = [
  "Kg",
  "Gram",
  "Liter",
  "mL",
  "Unit",
  "Botol",
  "Sachet",
  "Dos",
];
const kemasanList = [
  "Botol",
  "Sachet",
  "Dos",
  "Jerigen",
  "Drum",
  "Pouch",
  "Lainnya",
];

interface SpesifikasiForm {
  parameter_uji: string;
  tipe_batas: "RANGE" | "MIN" | "MAX" | "TEXT";
  nilai_min: string;
  nilai_maks: string;
  satuan: string;
  keterangan: string;
}

interface ProdukForm {
  kode_produk: string;
  nama_produk: string;
  kategori: string;
  satuan: string;
  status_halal: string;
  tipe_kemasan: string;
}

const emptyForm: ProdukForm = {
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
  const [filter, setFilter] = useState("all");
  const [order, setOrder] = useState("default");
  const requestSeq = useRef(0);
  const editSeq = useRef(0);
  const detailSeq = useRef(0);
  const [detail, setDetail] = useState<MasterProduk | null>(null);
  const [detailSpecs, setDetailSpecs] = useState<SpesifikasiItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const appending = useRef(false);
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
        .from("master_produk")
        .select("*", { count: "exact" })
        .order(order === "default" ? "nama_produk" : "created_at", {
          ascending: order !== "newest",
        })
        .order("id")
        .range(start, start + pageSize - 1);
      if (filter !== "all") q = q.eq("status_halal", filter);
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
        if (append) setLoadingMore(false);
        return;
      }
      if (error) {
        // A failed load-more keeps the accumulated rows and leaves the offset
        // unchanged, so retrying "Muat lagi" re-requests the same page.
        if (!append) {
          setLoadError(true);
          setProdukList([]);
          setTotalCount(0);
        }
        toast.error("Gagal memuat data. Coba lagi.");
      } else {
        const rows = (data as MasterProduk[]) ?? [];
        setLoadError(false);
        setProdukList((prev) => (append ? [...prev, ...rows] : rows));
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

  useEffect(() => {
    const sequence = requestSeq;
    const timer = setTimeout(() => {
      void fetchData();
    }, 0);
    return () => {
      clearTimeout(timer);
      sequence.current++;
      appending.current = false;
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
      toast.error("Gagal memuat data. Coba lagi.");
      return;
    }

    setForm({
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
      toast.error("Kode dan nama produk wajib diisi.");
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
        toast.error(res.error ?? "Gagal menyimpan produk. Coba lagi.");
        return;
      }
      toast.success(
        editingId
          ? "Produk berhasil diperbarui."
          : "Produk berhasil ditambahkan.",
      );
      setDialogOpen(false);
      resetForm();
      fetchData();
    } catch {
      // Transport error (mis. jaringan putus): server action melempar, bukan
      // mengembalikan { ok:false } — tanpa catch user tidak lihat apa pun.
      toast.error("Gagal terhubung ke server. Coba lagi.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (
      !(await confirm({
        title: "Hapus produk ini? Semua spesifikasi juga akan dihapus.",
        description:
          "Data yang dihapus tidak dapat dipulihkan melalui aplikasi. Pastikan data tidak lagi diperlukan.",
        confirmLabel: "Ya, hapus data",
      }))
    )
      return;

    // Server action: pre-check COA/hasil uji + role check server-side.
    try {
      const res = await deleteProdukAction(id);
      if (!res.ok) {
        toast.error(res.error ?? "Gagal menghapus produk. Coba lagi.");
        return;
      }
      toast.success("Produk dihapus.");
      fetchData();
    } catch {
      // transport error — action tetap { ok:false } untuk kegagalan aplikatif;
      // tanpa catch user tidak lihat apa pun.
      toast.error("Gagal terhubung ke server. Coba lagi.");
    }
  }

  const role: UserRole = (user?.role as UserRole) ?? "viewer";
  const canDelete = canAction(role, "delete_produk");
  const canCreate = canAction(role, "create_produk");
  const canUpdate = canAction(role, "update_produk");

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Master data"
        title="Master Produk"
        description="Standar yang konsisten dimulai dari produk yang tertata. Kelola katalog dan spesifikasi pengujian Anda."
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
                  <Plus className="size-4" /> Produk Baru
                </Button>
              }
            />
          )}

          <DialogContent className="flex max-h-[90svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
            <DialogHeader className="gap-1 border-b border-border-soft px-6 py-4 pr-14">
              <p className="micro-label">MASTER DATA</p>
              <DialogTitle className="text-2xl font-semibold tracking-tight">
                {editingId ? "Edit Produk" : "Tambah Produk Baru"}
              </DialogTitle>
              <DialogDescription className="mt-2 text-xs leading-relaxed">
                Definisikan identitas produk dan standar pengujian yang akan
                dipakai pada inspeksi.
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
                    <Field label="Kode Produk *" name="kode_produk" required>
                      <Input
                        value={form.kode_produk}
                        onChange={(e) =>
                          setForm({ ...form, kode_produk: e.target.value })
                        }
                        placeholder="PRD-001"
                      />
                    </Field>
                    <Field label="Nama Produk *" name="nama_produk" required>
                      <Input
                        value={form.nama_produk}
                        onChange={(e) =>
                          setForm({ ...form, nama_produk: e.target.value })
                        }
                        placeholder="Nama produk"
                      />
                    </Field>
                    <Field label="Kategori" name="kategori">
                      <select
                        className={selectClass}
                        value={form.kategori}
                        onChange={(e) =>
                          setForm({ ...form, kategori: e.target.value })
                        }
                      >
                        <option value="">Pilih…</option>
                        {kategoriList.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Satuan" name="satuan">
                      <select
                        className={selectClass}
                        value={form.satuan}
                        onChange={(e) =>
                          setForm({ ...form, satuan: e.target.value })
                        }
                      >
                        <option value="">Pilih…</option>
                        {satuanList.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Status Halal" name="status_halal">
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
                    <Field label="Tipe Kemasan" name="tipe_kemasan">
                      <select
                        className={selectClass}
                        value={form.tipe_kemasan}
                        onChange={(e) =>
                          setForm({ ...form, tipe_kemasan: e.target.value })
                        }
                      >
                        <option value="">Pilih…</option>
                        {kemasanList.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  {/* Spesifikasi section */}
                  <div className="border-t border-border pt-5">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <span className="micro-label">Spesifikasi Pengujian</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={addSpesifikasiRow}
                      >
                        <Plus className="size-3.5" /> Tambah Parameter
                      </Button>
                    </div>

                    {spesifikasi.length === 0 && (
                      <p className="text-[13px] text-muted">
                        Belum ada parameter. Klik &ldquo;Tambah Parameter&rdquo;
                        untuk menambahkan.
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
                              label="Tipe"
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
                              label="Maks"
                              name={`spesifikasi.${idx}.nilai_maks`}
                            >
                              <Input
                                disabled={
                                  sp.tipe_batas === "TEXT" ||
                                  sp.tipe_batas === "MIN"
                                }
                                inputMode="decimal"
                                value={sp.nilai_maks}
                                onChange={(e) =>
                                  updateSpesifikasi(
                                    idx,
                                    "nilai_maks",
                                    e.target.value,
                                  )
                                }
                                placeholder="Maks"
                              />
                            </Field>
                            <Field
                              label="Satuan"
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
                                placeholder="Satuan"
                              />
                            </Field>
                          </div>
                          <button
                            type="button"
                            className="row-action mt-6 shrink-0"
                            data-tone="danger"
                            onClick={() => removeSpesifikasi(idx)}
                            title="Hapus"
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
                  render={<Button variant="outline">Batal</Button>}
                />
                <Button type="submit" loading={saving} disabled={saving}>
                  {saving ? "Menyimpan…" : editingId ? "Simpan" : "Tambah"}
                </Button>
              </DialogFooter>
            </DomainForm>
          </DialogContent>
        </DomainDialog>
      </PageHeader>

      <div>
        <FilterTabs
          label="Filter produk"
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: "Semua produk" },
            { value: "Halal", label: "Halal" },
            { value: "Non-Halal", label: "Non-Halal" },
          ]}
        />
        <DataToolbar
          search={searchInput}
          onSearch={onSearchChange}
          placeholder="Cari produk…"
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
              <TableHead className="pl-4">Produk</TableHead>
              <TableHead>Kategori</TableHead>
              <TableHead>Satuan</TableHead>
              <TableHead>Halal</TableHead>
              <TableHead>Kemasan</TableHead>
              <TableHead className="pr-4">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableSkeleton rows={5} cols={6} />}
            {!loading && loadError && (
              <TableRow>
                <TableCell colSpan={6} className="!p-0">
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
            {!loading && !loadError && produkList.length === 0 && (
              <TableRow className="hover:bg-surface">
                <TableCell colSpan={6} className="!p-0">
                  <div className="empty-state">
                    <div className="empty-icon">
                      <PackageSearch className="size-4" />
                    </div>
                    <p className="text-base font-semibold tracking-tight">
                      {search || filter !== "all"
                        ? "Tidak ada hasil yang cocok"
                        : "Katalog produk masih kosong"}
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
                        onClick={() => setDialogOpen(true)}
                      >
                        <Plus className="size-3.5" /> Produk Baru
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
                    <div className="row-actions">
                      <button
                        type="button"
                        className="row-action"
                        onClick={() => void openDetail(p)}
                        title="Detail produk"
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

      <Dialog
        open={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open) {
            detailSeq.current++;
            setDetail(null);
          }
        }}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <p className="micro-label">Spesifikasi produk</p>
            <DialogTitle>{detail?.nama_produk}</DialogTitle>
            <DialogDescription>
              {detail?.kode_produk} · Standar pengujian yang sedang berlaku.
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <>
              <dl className="my-6 grid grid-cols-2 gap-5 rounded-xl border border-border-soft bg-surface-alt p-5">
                {[
                  ["Kategori", detail.kategori],
                  ["Satuan", detail.satuan],
                  ["Status halal", detail.status_halal],
                  ["Kemasan", detail.tipe_kemasan],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="micro-label">{label}</dt>
                    <dd className="mt-2 text-sm font-medium">{value || "—"}</dd>
                  </div>
                ))}
              </dl>
              <h3 className="mb-3 text-sm font-semibold">
                Parameter pengujian
              </h3>
              {detailLoading ? (
                <p
                  role="status"
                  className="py-8 text-center text-sm text-muted"
                >
                  Memuat spesifikasi…
                </p>
              ) : detailError ? (
                <EmptyState
                  error
                  title="Spesifikasi belum berhasil dimuat"
                  description="Coba muat ulang untuk melihat standar produk ini."
                >
                  <Button
                    variant="outline"
                    onClick={() => void openDetail(detail)}
                  >
                    Coba lagi
                  </Button>
                </EmptyState>
              ) : detailSpecs.length === 0 ? (
                <p className="rounded-xl bg-surface-alt p-5 text-sm text-muted">
                  Belum ada parameter pengujian untuk produk ini.
                </p>
              ) : (
                <div className="data-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Parameter</TableHead>
                        <TableHead>Batas</TableHead>
                        <TableHead>Satuan</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailSpecs.map((sp) => (
                        <TableRow key={sp.id}>
                          <TableCell className="font-medium">
                            {sp.parameter_uji}
                          </TableCell>
                          <TableCell className="font-data">
                            {sp.tipe_batas === "TEXT"
                              ? sp.keterangan || "Teks"
                              : sp.tipe_batas === "MIN"
                                ? `≥ ${sp.nilai_min}`
                                : sp.tipe_batas === "MAX"
                                  ? `≤ ${sp.nilai_maks}`
                                  : `${sp.nilai_min} – ${sp.nilai_maks}`}
                          </TableCell>
                          <TableCell>{sp.satuan || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
          <DialogFooter className="mt-6">
            <DialogClose render={<Button variant="outline">Tutup</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {!loading && !loadError && produkList.length > 0 && (
        <DataPagination
          count={produkList.length}
          total={totalCount}
          loading={loadingMore}
          onMore={() => void loadMore()}
        />
      )}
    </div>
  );
}
