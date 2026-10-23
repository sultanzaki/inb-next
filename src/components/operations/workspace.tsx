"use client";
import { useWorkPosition } from "@/components/workspace/use-work-position";
import Link from "next/link";
import { useState, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Plus,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Printer,
  Download,
  ShieldCheck,
  Search,
} from "lucide-react";
import { useERP } from "@/components/erp/context";
import { ERPModal, ERPModuleGuard } from "@/components/erp/shared";
import {
  workCollections,
  workCommands,
  workHref,
  type WorkRow,
} from "@/lib/operations/catalog";
import { humanLabel, displayNumber } from "@/lib/erp/ux";
import { useFileDownload } from "@/components/workspace/use-file-download";
import { useWorkRecords } from "./data";
import { CommandForm } from "./command-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  PageHeader,
  EmptyState,
  DataPagination,
} from "@/components/workspace/page-ui";
import { RecordSkeleton } from "@/components/workspace/record-loading";
import { CopyValue } from "@/components/workspace/data-tools";
import { RowActions } from "@/components/workspace/row-actions";
import { AdvancedRecordsTable } from "@/components/tables/advanced-records-table";
import { useTableState } from "@/components/tables/use-table-state";
const numeric =
  /(quantity|minimum_stock|remaining|received|lost|outstanding|tolerance_percent|yield_percent|reserved|available|packed|on_hand)$/;
function shown(value: unknown, key = ""): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (numeric.test(key) || typeof value === "number")
    return displayNumber(String(value));
  if (key === "state" || key === "kind" || key === "role")
    return humanLabel(String(value));
  return String(value);
}
function DetailRows({
  title,
  rows,
}: {
  title: string;
  rows: Record<string, unknown>[];
}) {
  return (
    <section className="work-detail-section">
      <div className="work-section-heading">
        <h3>{title}</h3>
        <span>
          {rows.length} {rows.length === 1 ? "item" : "items"}
        </span>
      </div>
      {!rows.length ? (
        <p className="work-quiet">No records yet.</p>
      ) : (
        <div className="work-detail-rows">
          {rows.map((item, index) => (
            <article key={String(item.id || index)}>
              <strong>
                {String(
                  item.material ||
                    item.product ||
                    item.name ||
                    item.lot ||
                    item.number ||
                    item.label ||
                    "Line " + (index + 1),
                )}
              </strong>
              <dl>
                {Object.entries(item)
                  .filter(
                    ([key, value]) =>
                      value != null &&
                      value !== "" &&
                      !key.endsWith("_id") &&
                      ![
                        "id",
                        "material",
                        "product",
                        "name",
                        "number",
                        "label",
                        "created_at",
                        "measured_by",
                        "created_by",
                        "transaction_id",
                        "snapshot",
                      ].includes(key) &&
                      typeof value !== "object",
                  )
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt>{humanLabel(key)}</dt>
                      <dd>{shown(value, key)}</dd>
                    </div>
                  ))}
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
function History({ entity, id }: { entity: string; id: string }) {
  const [page, setPage] = useState(1);
  const result = useWorkRecords("history", { id, source: entity, page });
  return (
    <section className="work-detail-section">
      <h3>Change history</h3>
      {result.loading ? (
        <RecordSkeleton compact label="Loading history…" />
      ) : result.error ? (
        <div role="alert">
          {result.error}
          <Button variant="outline" size="sm" onClick={result.refresh}>
            Retry history
          </Button>
        </div>
      ) : (
        <>
          <ol className="work-history">
            {result.data.rows.map((event) => (
              <li key={event.id} id={"audit-WORK-" + event.id}>
                <span className="work-history-dot" />
                <div>
                  <strong>{humanLabel(String(event.action))}</strong>
                  <p>
                    {String(event.actor)} ·{" "}
                    {new Date(String(event.created_at)).toLocaleString(
                      "en-GB",
                      { timeZone: "Asia/Jakarta" },
                    )}{" "}
                    WIB · WORK-{event.id}{" "}
                    <CopyValue
                      value={"WORK-" + event.id}
                      label="Copy audit reference"
                    />
                  </p>
                  {Boolean(event.reason) && <p>{String(event.reason)}</p>}
                  <details>
                    <summary>View changes</summary>
                    <div className="work-change-list">
                      {[
                        ...new Set([
                          ...Object.keys((event.before_data || {}) as object),
                          ...Object.keys((event.after_data || {}) as object),
                        ]),
                      ]
                        .filter(
                          (key) =>
                            ![
                              "id",
                              "version",
                              "created_at",
                              "created_by",
                            ].includes(key) &&
                            JSON.stringify(
                              (event.before_data as WorkRow)?.[key],
                            ) !==
                              JSON.stringify(
                                (event.after_data as WorkRow)?.[key],
                              ),
                        )
                        .map((key) => {
                          const before = (event.before_data as WorkRow)?.[key],
                            after = (event.after_data as WorkRow)?.[key];
                          const value = (v: unknown) =>
                            typeof v === "object" && v != null
                              ? Array.isArray(v)
                                ? `${v.length} items`
                                : "Updated details"
                              : shown(v, key);
                          return (
                            <div key={key}>
                              <strong>{humanLabel(key)}</strong>
                              <span>{value(before)}</span>
                              <span aria-hidden>→</span>
                              <span>{value(after)}</span>
                            </div>
                          );
                        })}
                    </div>
                  </details>
                </div>
              </li>
            ))}
          </ol>
          {!result.data.total && (
            <p className="work-quiet">No changes recorded yet.</p>
          )}
          {result.data.total > 50 && (
            <DataPagination
              count={result.data.rows.length}
              total={result.data.total}
              page={page}
              pageSize={50}
              loading={result.loading}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </section>
  );
}
function Genealogy({ lot }: { lot: string }) {
  const result = useWorkRecords("genealogy", { id: lot });
  return (
    <section className="work-detail-section">
      <h3>Material → production → batch</h3>
      {result.loading ? (
        <RecordSkeleton compact label="Loading batch genealogy…" />
      ) : result.error ? (
        <p role="alert">{result.error}</p>
      ) : result.data.rows.length ? (
        result.data.rows.map((row) => (
          <div key={row.id}>
            <Link
              className="work-record-link"
              href={workHref("manufacturing_orders", row.id)}
            >
              {String(row.number)}
              <ArrowUpRight className="size-3.5" />
            </Link>
            <DetailRows
              title="Material use"
              rows={(row.inputs as WorkRow[]) || []}
            />
            <DetailRows
              title="Finished batches"
              rows={(row.outputs as WorkRow[]) || []}
            />
            <DetailRows
              title="Customer deliveries"
              rows={(row.deliveries as WorkRow[]) || []}
            />
          </div>
        ))
      ) : (
        <p className="work-quiet">
          No linked manufacturing record. Historical material usage is not
          reconstructed.
        </p>
      )}
    </section>
  );
}
const stages: Record<string, string[]> = {
  manufacturing_orders: [
    "draft",
    "released",
    "in_progress",
    "completed",
    "closed",
  ],
  sample_requests: [
    "requested",
    "approved",
    "prepared",
    "shipped",
    "feedback",
    "converted",
  ],
  warehouse_transfers: ["draft", "in_transit", "partial", "received"],
  deviations: [
    "open",
    "investigating",
    "awaiting_approval",
    "approved",
    "closed",
  ],
  capas: ["open", "in_progress", "awaiting_review", "verified"],
};
export function OperationsWorkspace({ entity }: { entity: string }) {
  const definition = workCollections[entity],
    erp = useERP(),
    router = useRouter(),
    pathname = usePathname(),
    params = useSearchParams();
  const [q, setQ] = useState(params.get("q") || ""),
    [search, setSearch] = useState(q),
    [state, setState] = useState(""),
    [page, setPage] = useState(1),
    [action, setAction] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(params.get("record"));
  const positionReady = useWorkPosition(entity, { q, state, page }, (saved) => {
    setQ(saved.q);
    setSearch(saved.q);
    setState(saved.state);
    setPage(saved.page);
  });
  const files = useFileDownload();
  const table = useTableState("work_" + entity, () => setPage(1));
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(q);
      if (q !== search) setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [q, search]);
  useEffect(() => {
    const timer = setTimeout(() => setSelected(params.get("record")), 0);
    return () => clearTimeout(timer);
  }, [params]);
  const list = useWorkRecords(
    entity,
    {
      q: search,
      state,
      page,
      grid: table.query,
    },
    table.ready && positionReady,
  );
  const detail = useWorkRecords(entity, { id: selected }, Boolean(selected));
  const row = detail.data.rows[0];
  function select(id: string | null) {
    setSelected(id);
    const next = new URLSearchParams(params.toString());
    if (id) next.set("record", id);
    else next.delete("record");
    if (next.toString() !== params.toString())
      router.replace(pathname + (next.size ? "?" + next : ""), {
        scroll: false,
      });
  }
  function permitted(name: string) {
    const command = workCommands[name];
    return Boolean(
      command &&
      erp.can(definition.module, "read") &&
      erp.can(command.module, command.verb || "write") &&
      (!command.requires ||
        command.requires.every((p) => erp.can(p.module, p.verb))) &&
      (![
        "save_warehouse",
        "save_warehouse_location",
        "set_warehouse_access",
      ].includes(name) ||
        erp.data?.admin),
    );
  }
  const commands = (definition.actions || []).filter(
    (name) =>
      permitted(name) &&
      (!workCommands[name].states ||
        workCommands[name].states!.includes(row?.state || "")),
  );
  const visibleFacts = row
    ? Object.entries(row).filter(
        ([key, value]) =>
          value != null &&
          value !== "" &&
          typeof value !== "object" &&
          !key.endsWith("_id") &&
          ![
            "id",
            "label",
            "version",
            "created_by",
            "approved_by",
            "assignee",
            "root_id",
            "number",
            "state",
            "file_url",
            "file_url",
            "created_at",
            "formula_id",
          ].includes(key),
      )
    : [];
  const workflow = stages[entity],
    current = workflow?.indexOf(row?.state || "") ?? -1;
  function done(result: { id: string; entity: string }) {
    setAction(null);
    list.refresh();
    detail.refresh();
    if (result.entity === entity) select(result.id);
    else if (workCollections[result.entity])
      router.push(workHref(result.entity, result.id));
  }
  return (
    <ERPModuleGuard module={definition.module}>
      <div className="work-workspace">
        <PageHeader
          eyebrow={humanLabel(definition.module)}
          title={definition.title}
          description={definition.description}
        >
          {definition.create && permitted(definition.create) ? (
            <Button
              disabled={Boolean(action)}
              onClick={() => {
                select(null);
                setAction(definition.create!);
              }}
            >
              <Plus className="size-4" />
              {workCommands[definition.create].label}
            </Button>
          ) : undefined}
        </PageHeader>
        <div className="work-context-strip">
          <span>
            <ShieldCheck className="size-3.5" />
            Traceable operations
          </span>
          <span>Drafts preserve stock · Posted actions retain history</span>
        </div>
        <div className="work-list-tools">
          <div className="work-search">
            <Search className="size-4" />
            <Input
              placeholder={"Search " + definition.title.toLowerCase() + "…"}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search records"
            />
          </div>
          <label>
            Status
            <select
              aria-label="Filter status"
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {[
                ...new Set([
                  ...(workflow || []),
                  "draft",
                  "approved",
                  "published",
                  "open",
                  "awaiting_review",
                  "pass",
                  "fail",
                  "quarantine",
                  "released",
                  "rejected",
                  "packed",
                  "empty",
                  "in_transit",
                  "active",
                  "expired",
                  "withdrawn",
                  "cancelled",
                  "closed",
                ]),
              ].map((value) => (
                <option key={value} value={value}>
                  {humanLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <span className="work-result-count">
            {list.loading ? "Loading…" : `${list.data.total} records`}
          </span>
        </div>
        {list.error ? (
          <EmptyState
            error
            title="Could not load this workspace"
            description={list.error}
          >
            <Button variant="outline" onClick={list.refresh}>
              Retry
            </Button>
          </EmptyState>
        ) : (
          <AdvancedRecordsTable
            state={table}
            rows={list.data.rows}
            summary={list.data.summary}
            search={search}
            status={state}
            onRestore={(q, s) => {
              setQ(q);
              setState(s);
              setPage(1);
            }}
            exportURL={`/api/operations/${entity}?q=${encodeURIComponent(search)}&state=${encodeURIComponent(state)}&export=csv`}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  {definition.columns.map((column) => (
                    <TableHead key={column.key}>{column.label}</TableHead>
                  ))}
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.loading ? (
                  <TableRow>
                    <TableCell colSpan={definition.columns.length + 1}>
                      <RecordSkeleton compact label="Loading records…" />
                    </TableCell>
                  </TableRow>
                ) : !list.data.rows.length ? (
                  <TableRow>
                    <TableCell colSpan={definition.columns.length + 1}>
                      <EmptyState
                        title="No records yet"
                        description={
                          q || state
                            ? "Adjust your search or filters."
                            : "Create the first record when the required master data is ready."
                        }
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  list.data.rows.map((record) => (
                    <TableRow key={record.id}>
                      {definition.columns.map((column, index) => (
                        <TableCell key={column.key}>
                          {index === 0 ? (
                            <button
                              type="button"
                              className="work-record-link"
                              onClick={() => select(record.id)}
                            >
                              {shown(record[column.key], column.key)}
                              <ArrowUpRight className="size-3.5" />
                            </button>
                          ) : column.key === "state" ? (
                            <Badge
                              variant={
                                ["fail", "rejected", "expired"].includes(
                                  String(record.state),
                                )
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              {humanLabel(String(record.state || "—"))}
                            </Badge>
                          ) : (
                            shown(record[column.key], column.key)
                          )}
                        </TableCell>
                      ))}
                      <TableCell>
                        <RowActions>
                          <button
                            type="button"
                            className="row-action"
                            title="Open record"
                            onClick={() => select(record.id)}
                          >
                            <ArrowUpRight className="size-3.5" />
                          </button>
                          <CopyValue
                            value={String(
                              record.number || record.label || record.id,
                            )}
                          />
                        </RowActions>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </AdvancedRecordsTable>
        )}
        {!list.error && list.data.total > 0 && (
          <DataPagination
            count={list.data.rows.length}
            total={list.data.total}
            page={page}
            pageSize={50}
            loading={list.loading}
            onPageChange={setPage}
          />
        )}
        <p className="work-workspace-footnote">
          Quantities use the configured product or material unit. Dates follow
          the Jakarta business calendar.
        </p>
      </div>
      {selected && !action && (
        <ERPModal
          layout="record"
          loading={detail.loading}
          title={String(row?.number || row?.label || definition.singular)}
          description={
            row?.state
              ? "Status: " + humanLabel(row.state)
              : "Review details and linked operations"
          }
          onClose={() => select(null)}
        >
          {detail.error ? (
            <EmptyState
              error
              title="Could not load record"
              description={detail.error}
            >
              <Button variant="outline" onClick={detail.refresh}>
                Retry
              </Button>
            </EmptyState>
          ) : !row ? (
            <p>Record not found.</p>
          ) : (
            <>
              <div className="work-detail-identity">
                <Badge>{humanLabel(row.state || "record")}</Badge>
                <CopyValue value={String(row.number || row.id)} />
                {entity === "pallets" && (
                  <Link
                    className="work-record-link"
                    href={`/api/operations-label/${row.id}`}
                    target="_blank"
                  >
                    <Printer className="size-3.5" />
                    Print pallet label
                  </Link>
                )}
              </div>
              {[
                "manufacturing_orders",
                "incoming_inspections",
                "warehouse_transfers",
              ].includes(entity) && (
                <div className="work-command-actions">
                  {(entity === "manufacturing_orders"
                    ? [
                        ["batch", "Batch sheet PDF"],
                        ["materials", "Material usage PDF"],
                      ]
                    : entity === "incoming_inspections"
                      ? [["incoming", "Inspection PDF"]]
                      : [["transfer", "Transfer PDF"]]
                  ).map(([kind, label]) => (
                    <Button
                      key={kind}
                      size="sm"
                      variant="outline"
                      disabled={Boolean(files.busy)}
                      loading={files.busy === kind}
                      onClick={() =>
                        files.download(
                          `/api/operations-document/${kind}/${row.id}?download=1`,
                          `${row.number}-${kind}.pdf`,
                          kind,
                        )
                      }
                    >
                      <Download className="size-3.5" />
                      {label}
                    </Button>
                  ))}
                </div>
              )}
              {workflow && current >= 0 && (
                <ol className="work-progress" aria-label="Record progress">
                  {workflow.map((state, index) => (
                    <li key={state} data-complete={index <= current}>
                      <span>
                        {index < current ? (
                          <CheckCircle2 className="size-3.5" />
                        ) : index === current ? (
                          <Clock3 className="size-3.5" />
                        ) : (
                          index + 1
                        )}
                      </span>
                      {humanLabel(state)}
                    </li>
                  ))}
                </ol>
              )}
              <div className="work-command-actions">
                {commands.map((name) => (
                  <Button
                    variant={name === commands[0] ? "default" : "outline"}
                    size="sm"
                    key={name}
                    disabled={Boolean(action)}
                    onClick={() => setAction(name)}
                  >
                    {workCommands[name].label}
                  </Button>
                ))}
              </div>
              <dl className="work-facts">
                {visibleFacts.map(([key, value]) => (
                  <div key={key}>
                    <dt>{humanLabel(key)}</dt>
                    <dd>{shown(value, key)}</dd>
                  </div>
                ))}
              </dl>
              {Boolean(row.file_url) && (
                <a
                  href={String(row.file_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="work-record-link"
                >
                  Open version-specific document
                  <ArrowUpRight className="size-3.5" />
                </a>
              )}
              {entity === "manufacturing_orders" && (
                <>
                  <DetailRows
                    title="Formula requirements"
                    rows={
                      (row.formula_snapshot as { requirements?: WorkRow[] })
                        ?.requirements || []
                    }
                  />
                  <DetailRows
                    title="Planned versus net actual use"
                    rows={(row.material_usage as WorkRow[]) || []}
                  />
                  <DetailRows
                    title="Production deviations"
                    rows={(row.deviations as WorkRow[]) || []}
                  />
                  <DetailRows
                    title="Material reservations"
                    rows={(row.reservations as WorkRow[]) || []}
                  />
                  <DetailRows
                    title="Actual material use & returns"
                    rows={(row.inputs as WorkRow[]) || []}
                  />
                  <DetailRows
                    title="Finished batches"
                    rows={(row.outputs as WorkRow[]) || []}
                  />
                  <DetailRows
                    title="Customer deliveries"
                    rows={(row.deliveries as WorkRow[]) || []}
                  />
                  {Boolean((row.outputs as WorkRow[])?.[0]?.lot_id) && (
                    <Genealogy
                      lot={String((row.outputs as WorkRow[])[0].lot_id)}
                    />
                  )}
                </>
              )}
              {entity === "formulas" && (
                <DetailRows
                  title="Formula materials & packaging"
                  rows={(row.lines as WorkRow[]) || []}
                />
              )}{" "}
              {entity === "material_specs" && (
                <DetailRows
                  title="Inspection parameters"
                  rows={(row.parameters as WorkRow[]) || []}
                />
              )}{" "}
              {entity === "incoming_inspections" && (
                <>
                  <DetailRows
                    title="Captured specification"
                    rows={
                      (row.spec_snapshot as { parameters?: WorkRow[] })
                        ?.parameters || []
                    }
                  />
                  <DetailRows
                    title="Recorded results"
                    rows={(row.results as WorkRow[]) || []}
                  />
                </>
              )}{" "}
              {entity === "warehouse_transfers" && (
                <DetailRows
                  title="Transfer manifest & receipt"
                  rows={(row.lines as WorkRow[]) || []}
                />
              )}{" "}
              {entity === "pallets" && (
                <DetailRows
                  title="Packed contents"
                  rows={(row.contents as WorkRow[]) || []}
                />
              )}{" "}
              {entity === "warehouse_access" && (
                <DetailRows
                  title="Assigned warehouses"
                  rows={(row.warehouses as WorkRow[]) || []}
                />
              )}{" "}
              {entity === "document_distributions" && (
                <DetailRows
                  title="Document revision sent"
                  rows={[row.document_snapshot as WorkRow]}
                />
              )}{" "}
              {Boolean(row.quote_id) && (
                <Link
                  className="work-record-link"
                  href={`/dashboard/sales?view=quotes&record=${row.quote_id}`}
                >
                  Open linked quotation
                  <ArrowUpRight className="size-3.5" />
                </Link>
              )}{" "}
              {((entity.endsWith("inventory") && row.lot_id) ||
                entity === "material_lots") && (
                <Genealogy lot={String(row.lot_id || row.id)} />
              )}{" "}
              {!row.id.includes(":") && <History entity={entity} id={row.id} />}
            </>
          )}
        </ERPModal>
      )}
      {action && (
        <CommandForm
          key={action + ":" + (selected || "new")}
          action={action}
          row={selected ? row : undefined}
          onClose={() => setAction(null)}
          onDone={done}
        />
      )}
    </ERPModuleGuard>
  );
}
