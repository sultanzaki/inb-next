"use client";
import { RowActions } from "@/components/workspace/row-actions";
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
import { documentSchema } from "@/lib/domain/validation";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "../../user-context";
import { canAction } from "@/lib/types";
import type { DokumenArsip, UserRole } from "@/lib/types";
import { toast } from "sonner";
import {
  uploadDokumenAction,
  deleteDokumenAction,
} from "@/lib/actions/arsip-actions";
import { Plus, Trash2, ExternalLink, FileSearch } from "lucide-react";
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
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

// Module-level browser client: a single instance instead of one per render.
const sb = createClient();

// Monotonic counter used to ignore stale list-fetch responses (fast typing
// through the debounced search).

const kategoriDocList = [
  "Halal certificate",
  "BPOM certificate",
  "Quality certificate",
  "SOP",
  "Quality policy",
  "Audit report",
  "Contract",
  "Other",
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
  tanggal_berlaku: "",
  masa_kadaluarsa: "",
  link_drive: "",
};

// Render-side allowlist mirroring uploadDokumenAction: only http(s) links
// become anchors, so a legacy javascript:/data: row can never be clicked.
function safeHref(link: string): string | null {
  const trimmed = link.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

// Status is always a dot-chip: success tint while valid, danger once expired.
function StatusDocBadge({ expired }: { expired: boolean }) {
  if (expired) {
    return (
      <span className="inline-flex items-center gap-2 rounded-[4px] bg-danger-bg px-2 py-1 text-[11.5px] font-medium leading-tight text-danger-dark">
        <span
          className="size-[5px] rounded-full bg-danger"
          aria-hidden="true"
        />
        Expired
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-[4px] bg-success-bg px-2 py-1 text-[11.5px] font-medium leading-tight text-success-dark">
      <span className="size-[5px] rounded-full bg-success" aria-hidden="true" />
      Valid
    </span>
  );
}

// Native select styled to match the Input kit (hairline border, 36px, 6px
// radius); focus border + ring come from the global input/select rule.
const selectClass =
  "h-9 w-full rounded-md border border-input bg-surface px-2.5 text-sm transition-colors duration-150 outline-none";

export default function DokumenPage() {
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

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dokumenList, setDokumenList] = useState<DokumenArsip[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<DocForm>(emptyForm);
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
        .from("dokumen_arsip")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: order === "oldest" })
        .order("id")
        .range(start, start + pageSize - 1);
      if (filter === "active") q = q.gte("masa_kadaluarsa", localTodayStr());
      if (filter === "expired") q = q.lt("masa_kadaluarsa", localTodayStr());
      if (advanced.from) q = q.gte("tanggal_berlaku", advanced.from);
      if (advanced.to) q = q.lte("tanggal_berlaku", advanced.to);
      if (advanced.category) q = q.eq("kategori", advanced.category);
      if (search) {
        const term = escapeOr(search);
        q = q.or(`judul_dokumen.ilike."%${term}%",kategori.ilike."%${term}%"`);
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
          setDokumenList([]);
          setTotalCount(0);
        }
        toast.error("Could not load data. Retry.");
      } else {
        const rows = (data as DokumenArsip[]) ?? [];
        setLoadError(false);
        setDokumenList(rows);
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
    setForm({ ...emptyForm, tanggal_berlaku: localTodayStr() });
  }

  async function handleSave() {
    if (!form.judul_dokumen || !form.kategori) {
      toast.error("Title and category are required.");
      return;
    }
    setSaving(true);

    try {
      // Mutasi lewat server action: sesi + peran dicek server-side.
      const res = await uploadDokumenAction({
        judul_dokumen: form.judul_dokumen,
        kategori: form.kategori,
        tanggal_berlaku: form.tanggal_berlaku,
        masa_kadaluarsa: form.masa_kadaluarsa,
        link_drive: form.link_drive,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Could not save the document. Retry.");
        return;
      }
      toast.success("Document added.");
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
        title: "Delete this document?",
        description: "This cannot be undone.",
        confirmLabel: "Delete record",
      }))
    )
      return;

    // Server action: role check server-side.
    try {
      const res = await deleteDokumenAction(id);
      if (!res.ok) {
        toast.error(res.error ?? "Could not delete the document. Retry.");
        return;
      }
      toast.success("Document deleted.");
      fetchData();
    } catch {
      // transport error — action tetap { ok:false } untuk kegagalan aplikatif;
      // tanpa catch user tidak lihat apa pun.
      toast.error("Could not reach the server. Retry.");
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
  // dokumen_arsip writes are gated by create_doc, limited to the same
  // privileged set as delete_doc ('admin qc', 'administrator inbionusa').
  // Hide the upload trigger for other roles, whose insert would only fail
  // server-side with a raw RLS error.
  const canUpload = canAction(role, "create_doc");

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Quality documents"
        title="Documents"
        description="Supporting documents and expiry dates."
      >
        <DomainDialog
          dirtyValue={form}
          busy={saving}
          open={dialogOpen}
          onOpenChange={(v) => {
            if (v) resetForm();
            setDialogOpen(v);
            if (!v) resetForm();
          }}
        >
          {canUpload && (
            <DialogTrigger
              render={
                <Button>
                  <Plus className="size-4" /> Add document
                </Button>
              }
            />
          )}

          <DialogContent className="flex max-h-[90svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
            <DialogHeader className="gap-1 border-b border-border-soft px-6 py-4 pr-14">
              <p className="micro-label">DOCUMENTS</p>
              <DialogTitle className="text-2xl font-semibold tracking-tight">
                Add document
              </DialogTitle>
              <DialogDescription className="mt-2 text-xs leading-relaxed">
                Add document details and a file link.
              </DialogDescription>
            </DialogHeader>
            <DomainForm
              value={form}
              schema={documentSchema}
              onSubmit={handleSave}
            >
              {/* Scrollable body; the footer stays pinned below it. */}
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <div className="space-y-4">
                  <Field label="Document title *" name="judul_dokumen" required>
                    <Input
                      value={form.judul_dokumen}
                      onChange={(e) =>
                        setForm({ ...form, judul_dokumen: e.target.value })
                      }
                      placeholder="Document name"
                    />
                  </Field>
                  <Field label="Category *" name="kategori" required>
                    <select
                      className={selectClass}
                      value={form.kategori}
                      onChange={(e) =>
                        setForm({ ...form, kategori: e.target.value })
                      }
                    >
                      <option value="">Select a category…</option>
                      {kategoriDocList.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field
                      label="Effective date"
                      name="tanggal_berlaku"
                      required
                    >
                      <Input
                        type="date"
                        value={form.tanggal_berlaku}
                        onChange={(e) =>
                          setForm({ ...form, tanggal_berlaku: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Expiry date" name="masa_kadaluarsa" required>
                      <Input
                        type="date"
                        value={form.masa_kadaluarsa}
                        onChange={(e) =>
                          setForm({ ...form, masa_kadaluarsa: e.target.value })
                        }
                      />
                    </Field>
                  </div>
                  <Field label="File link" name="link_drive">
                    <Input
                      value={form.link_drive}
                      onChange={(e) =>
                        setForm({ ...form, link_drive: e.target.value })
                      }
                      placeholder="https://drive.google.com/..."
                    />
                  </Field>
                </div>
              </div>

              <DialogFooter className="m-0 flex-row items-center justify-between gap-2 rounded-b-lg px-6 py-4 sm:justify-between">
                <DialogClose
                  render={<Button variant="outline">Cancel</Button>}
                />
                <Button type="submit" loading={saving} disabled={saving}>
                  {saving ? "Saving…" : "Add"}
                </Button>
              </DialogFooter>
            </DomainForm>
          </DialogContent>
        </DomainDialog>
      </PageHeader>

      <div>
        <FilterTabs
          label="Filter documents"
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: "All documents" },
            { value: "active", label: "Valid" },
            { value: "expired", label: "Expired" },
          ]}
        />
        <DataToolbar
          search={searchInput}
          onSearch={onSearchChange}
          placeholder="Search documents…"
          total={totalCount}
          loading={loading}
          onRefresh={() => void fetchData()}
          order={order}
          onOrder={setOrder}
        />
      </div>

      {/* Table card: hairline border, radius 8, header micro-labels on surface-alt */}
      <DataTools
        module="arsip"
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
              <TableHead className="pl-4">Documents</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Effective date</TableHead>
              <TableHead>Expiry date</TableHead>
              <TableHead>Status</TableHead>
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
            {!loading && !loadError && dokumenList.length === 0 && (
              <TableRow className="hover:bg-surface">
                <TableCell colSpan={6} className="!p-0">
                  <div className="empty-state">
                    <div className="empty-icon">
                      <FileSearch className="size-4" />
                    </div>
                    <p className="text-base font-semibold tracking-tight">
                      {search || filter !== "all"
                        ? "No matching results"
                        : "No documents yet"}
                    </p>
                    <p className="text-xs text-muted">
                      {search || filter !== "all"
                        ? "Try another keyword or clear your search."
                        : "Add your first record to get started."}
                    </p>
                    {!search && filter === "all" && canUpload && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          resetForm();
                          setDialogOpen(true);
                        }}
                      >
                        <Plus className="size-3.5" /> Add document
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
                        Clear filters
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              dokumenList.map((doc) => {
                const expired = isExpired(doc);
                const link = safeHref(doc.link_drive ?? "");
                return (
                  <TableRow key={doc.id}>
                    <TableCell className="pl-4">
                      <div className="font-medium">{doc.judul_dokumen}</div>
                      <div className="font-data text-xs text-muted">
                        {doc.id.slice(0, 8)}...
                        <CopyValue value={doc.id} label="Copy document ID" />
                      </div>
                    </TableCell>
                    <TableCell className="text-muted">{doc.kategori}</TableCell>
                    <TableCell className="font-data text-muted text-right">
                      {doc.tanggal_berlaku}
                    </TableCell>
                    <TableCell className="font-data text-muted text-right">
                      {doc.masa_kadaluarsa || "—"}
                    </TableCell>
                    <TableCell>
                      <StatusDocBadge expired={expired} />
                    </TableCell>
                    <TableCell className="pr-4">
                      <RowActions>
                        {link && (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="row-action"
                            title="Open link"
                            aria-label="Open document link"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            className="row-action"
                            data-tone="danger"
                            onClick={() => handleDelete(doc.id)}
                            title="Delete"
                            aria-label="Delete document"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </RowActions>
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </div>

      {!loading && !loadError && dokumenList.length > 0 && (
        <DataPagination
          count={dokumenList.length}
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
