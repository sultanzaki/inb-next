"use client";
import { RowActions } from "@/components/workspace/row-actions";
import { useCallback, useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
import { useUser } from "@/app/(dashboard)/user-context";
import { canAction, type AuditLogEntry } from "@/lib/types";
import {
  PageHeader,
  DataToolbar,
  DataPagination,
  EmptyState,
} from "@/components/workspace/page-ui";
import {
  DataTools,
  CopyValue,
  emptyFilters,
  type AdvancedFilters,
} from "@/components/workspace/data-tools";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/table-skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
type Audit = AuditLogEntry & { before_data?: unknown; after_data?: unknown };
export default function AuditPage() {
  const { user } = useUser(),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [advanced, setAdvanced] = useState<AdvancedFilters>({ ...emptyFilters }),
    [data, setData] = useState<Audit[]>([]),
    [total, setTotal] = useState(0),
    [pageOffset, setPageOffset] = useState(0),
    [loading, setLoading] = useState(true),
    [more, setMore] = useState(false),
    [error, setError] = useState(""),
    [detail, setDetail] = useState<Audit | null>(null),
    [detailLoading, setDetailLoading] = useState(false),
    [detailError, setDetailError] = useState(false);
  const seq = useRef(0),
    detailSeq = useRef(0);
  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const load = useCallback(
    async (offset = 0) => {
      const id = ++seq.current;
      if (offset) setMore(true);
      else setLoading(true);
      try {
        const r = await fetch(
          "/api/audit?" +
            new URLSearchParams({
              q: query,
              from: advanced.from,
              to: advanced.to,
              actor: advanced.person,
              action: advanced.category,
              offset: String(offset),
            }),
        );
        const v = await r.json();
        if (id !== seq.current) return;
        if (!r.ok) throw Error(v.message);
        setData(v.data);
        setPageOffset(offset);
        setTotal(v.count || 0);
        setError("");
      } catch (e) {
        if (id === seq.current) {
          if (offset) toast.error("Could not load this page of activities.");
          else {
            setError(e instanceof Error ? e.message : "Audit log unavailable.");
            setData([]);
          }
        }
      } finally {
        if (id === seq.current) {
          setLoading(false);
          setMore(false);
        }
      }
    },
    [query, advanced],
  );
  useEffect(() => {
    const sequence = seq;
    const t = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(t);
      sequence.current++;
    };
  }, [load]);
  async function show(row: Audit) {
    const id = ++detailSeq.current;
    setDetail(row);
    setDetailError(false);
    setDetailLoading(true);
    try {
      const r = await fetch("/api/audit?id=" + row.id),
        v = await r.json();
      if (!r.ok) throw Error();
      if (id === detailSeq.current) setDetail(v.data);
    } catch {
      if (id === detailSeq.current) setDetailError(true);
    } finally {
      if (id === detailSeq.current) setDetailLoading(false);
    }
  }
  if (!user || !canAction(user, "read_audit"))
    return (
      <EmptyState
        error
        title="Access restricted"
        description="Only administrators and QC admins can view the audit log."
      />
    );
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Administration"
        title="Audit log"
        description="Account activity and data changes."
      />
      <DataToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search users, actions, or references…"
        total={total}
        loading={loading}
        onRefresh={() => void load()}
      />
      <DataTools
        module="audit"
        search={query}
        filter="all"
        order="newest"
        filters={advanced}
        onFilters={setAdvanced}
        loading={loading}
      />
      <div className="data-card">
        <Table data-actions>
          <TableHeader>
            <TableRow>
              <TableHead>Time (WIB)</TableHead>
              <TableHead>Users</TableHead>
              <TableHead>Actions</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeleton rows={5} cols={5} />
            ) : error ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <EmptyState
                    error
                    title="Could not load the audit log"
                    description={error}
                  >
                    <Button variant="outline" onClick={() => void load()}>
                      Retry
                    </Button>
                  </EmptyState>
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <EmptyState
                    title="No matching activity"
                    description="Change the search or date range."
                  />
                </TableCell>
              </TableRow>
            ) : (
              data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs">
                    {new Intl.DateTimeFormat("en-GB", {
                      timeZone: "Asia/Jakarta",
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(row.waktu))}
                  </TableCell>
                  <TableCell>{row.user_name}</TableCell>
                  <TableCell>
                    <span className="audit-action">{row.aksi}</span>
                  </TableCell>
                  <TableCell className="max-w-56">
                    <span
                      className="inline-block max-w-48 truncate align-middle text-xs"
                      title={row.referensi}
                    >
                      {row.referensi || "—"}
                    </span>
                    {row.referensi && (
                      <CopyValue
                        value={row.referensi}
                        label="Copy audit reference"
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <RowActions>
                      {" "}
                      <button
                        type="button"
                        className="row-action"
                        title="Activity details"
                        onClick={() => void show(row)}
                      >
                        <Eye className="size-3.5" />
                      </button>
                    </RowActions>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {!loading && !error && (
        <DataPagination
          count={data.length}
          total={total}
          loading={more}
          page={Math.floor(pageOffset / 50) + 1}
          pageSize={50}
          onPageChange={(p) => void load((p - 1) * 50)}
        />
      )}
      <Dialog
        open={Boolean(detail)}
        onOpenChange={(v) => {
          if (!v) {
            detailSeq.current++;
            setDetail(null);
          }
        }}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Activity details</DialogTitle>
            <DialogDescription>
              {detail?.aksi} · {detail?.user_name}
            </DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <p role="status" className="py-8 text-sm text-muted">
              Loading changes…
            </p>
          ) : detailError ? (
            <EmptyState
              error
              title="Could not load details"
              description="Reload this activity."
            >
              <Button
                variant="outline"
                onClick={() => detail && void show(detail)}
              >
                Retry
              </Button>
            </EmptyState>
          ) : detail && !detail.before_data && !detail.after_data ? (
            <p className="py-5 text-sm text-muted">
              Detailed changes are unavailable for this older activity.
            </p>
          ) : (
            <div className="audit-diff">
              {[
                ["Before", detail?.before_data],
                ["After", detail?.after_data],
              ].map(([label, value]) => (
                <section key={String(label)}>
                  <h3>{String(label)}</h3>
                  <pre>{value ? JSON.stringify(value, null, 2) : "None"}</pre>
                </section>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
