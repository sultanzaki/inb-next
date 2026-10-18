"use client";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  SeriesForm,
  ReturnForm,
  ReturnDetail,
  LotTrace,
} from "./release-workflows";
import Link from "next/link";
import { Plus, Eye, FileDown, ExternalLink, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { PageHeader, DataPagination } from "@/components/workspace/page-ui";
import { RowActions } from "@/components/workspace/row-actions";
import { CopyValue, useSearchSeed } from "@/components/workspace/data-tools";
import { useERPPage } from "./data";
import { useERP } from "./context";
import {
  ERPModal,
  ERPForm,
  ERPField,
  ERPActionButton,
  ERPModuleGuard,
} from "./shared";
import {
  MoveForm,
  QuoteForm,
  CustomerForm,
  CountForm,
  CountEntryForm,
  CountAddForm,
  ReserveForm,
  DeliveryForm,
  ConfigurationForm,
  AssignCountForm,
} from "./forms";
import {
  decimal,
  type ERPRow,
  type ERPLine,
  type ERPAction,
  type ModuleKey,
  type CountLine,
  type OrderLine,
} from "@/lib/erp/schema";
type Area = "warehouse" | "production" | "sales" | "settings";
const sections: Record<
  Area,
  { key: string; label: string; create?: string; action?: ERPAction }[]
> = {
  warehouse: [
    { key: "stock", label: "Stock" },
    { key: "movements", label: "Movements", create: "New movement" },
    { key: "counts", label: "Stock counts", create: "Plan count" },
    { key: "lots", label: "Lots & traceability" },
    { key: "returns", label: "Returns", create: "Request return" },
    { key: "fulfillment", label: "Dispatch" },
    { key: "ledger", label: "Stock ledger" },
  ],
  production: [
    { key: "production", label: "Finished goods", create: "Record production" },
  ],
  sales: [
    { key: "quotes", label: "Quotations", create: "New quotation" },
    { key: "orders", label: "Sales orders" },
    { key: "customers", label: "Customers", create: "New customer" },
  ],
  settings: [
    { key: "modules", label: "Modules" },
    { key: "series", label: "Product series", create: "Set series" },
    { key: "units", label: "Units", create: "Add unit", action: "save_unit" },
    {
      key: "catalog",
      label: "Product units",
      create: "Configure conversion",
      action: "save_conversion",
    },
    {
      key: "locations",
      label: "Locations",
      create: "Add location",
      action: "save_location",
    },
    {
      key: "access",
      label: "Access",
      create: "Set access",
      action: "set_access",
    },
  ],
};
const names: Record<Area, string> = {
  warehouse: "Warehouse",
  production: "Production",
  sales: "Sales",
  settings: "Administration",
};
const descriptions: Record<Area, string> = {
  warehouse: "Know what is on hand, where it is, and what is ready to ship.",
  production: "Record finished batches. Review and post before stock changes.",
  sales: "From a clear quotation to a fulfilled customer order.",
  settings: "Modules, manual units, storage locations, and team access.",
};
const states: Record<string, string[]> = {
  returns: ["requested", "received", "released", "scrapped", "cancelled"],
  stock: ["quarantine", "released", "rejected"],
  lots: ["quarantine", "released", "rejected"],
  movements: ["draft", "posted", "reversed", "cancelled"],
  production: ["draft", "posted", "reversed", "cancelled"],
  counts: ["draft", "counting", "submitted", "posted", "cancelled"],
  quotes: [
    "draft",
    "pending",
    "issued",
    "accepted",
    "rejected",
    "superseded",
    "cancelled",
  ],
  orders: ["confirmed", "fulfilled", "closed"],
  fulfillment: ["confirmed", "fulfilled", "closed"],
};
function Status({ value }: { value?: string }) {
  return (
    <Badge
      variant={
        ["rejected", "cancelled", "expired"].includes(value || "")
          ? "destructive"
          : "default"
      }
    >
      {(value || "—").replaceAll("_", " ")}
    </Badge>
  );
}
function summary(entity: string, row: ERPRow) {
  if (entity === "stock") return `${row.lot_number} · ${row.location}`;
  if (entity === "quotes") return `${row.customer} · Revision ${row.revision}`;
  if (entity === "orders" || entity === "fulfillment") return row.customer;
  if (entity === "lots") return row.product;
  if (entity === "ledger") return `${row.product} · ${row.lot_number}`;
  if (entity === "catalog")
    return (
      row.units
        ?.map(
          (u) =>
            `${u.code} × ${decimal(u.factor)}${u.is_base ? " (base)" : ""}`,
        )
        .join(" · ") || "Base unit not configured"
    );
  if (entity === "series")
    return row.series ? "Series " + row.series : "Series not configured";
  if (entity === "returns") return `${row.product} · ${row.lot_number}`;
  if (entity === "access")
    return `${row.module} · Read ${row.can_read ? "yes" : "no"} · Write ${row.can_write ? "yes" : "no"} · Approve ${row.can_approve ? "yes" : "no"}`;
  return row.reason || row.location || row.destination || row.name || "";
}
function identity(row: ERPRow) {
  return (
    row.number ||
    row.product ||
    row.label ||
    row.name ||
    row.code ||
    row.username ||
    row.id
  );
}
export function ERPWorkspace({ area }: { area: Area }) {
  const erp = useERP(),
    tabs = sections[area];
  const params = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const [exporting, setExporting] = useState(false);
  const [tab, setTab] = useState(tabs[0].key),
    [search, setSearch] = useState(""),
    [state, setState] = useState(""),
    [page, setPage] = useState(1),
    [create, setCreate] = useState(false),
    [detail, setDetail] = useState<{ entity: string; id: string } | null>(null),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const view = params.get("view");
    if (view && tabs.some((t) => t.key === view)) {
      const t = setTimeout(() => {
        setTab(view);
        setSearch(params.get("q") || "");
        setState(params.get("state") || "");
        const p = Number(params.get("page") || 1);
        setPage(Number.isSafeInteger(p) && p > 0 && p <= 1000000 ? p : 1);
      }, 0);
      return () => clearTimeout(t);
    }
  }, [params, tabs]);
  function listURL(q = search, s = state, p = page) {
    const next = new URLSearchParams({ view: tab });
    if (q) next.set("q", q);
    if (s) next.set("state", s);
    if (p > 1) next.set("page", String(p));
    router.replace(pathname + "?" + next, { scroll: false });
  }
  const config = tabs.find((t) => t.key === tab)!,
    result = useERPPage(tab === "modules" ? "units" : tab, search, state, page);
  useSearchSeed((q) => {
    const view = new URLSearchParams(window.location.search).get("view");
    if (view && tabs.some((t) => t.key === view)) setTab(view);
    setSearch(q);
    setPage(
      Number(new URLSearchParams(window.location.search).get("page")) || 1,
    );
  });
  const canWrite =
    area === "settings"
      ? Boolean(erp.data?.admin)
      : erp.can(area as ModuleKey, "write");
  function done(id?: string, entity?: string) {
    setCreate(false);
    result.refresh();
    setRefresh((v) => v + 1);
    if (area === "settings") erp.refresh();
    if (
      id &&
      [
        "movements",
        "production",
        "quotes",
        "orders",
        "counts",
        "customers",
        "returns",
      ].includes(entity || tab)
    ) {
      setDetail({ entity: entity || tab, id });
      if (entity && tabs.some((t) => t.key === entity)) setTab(entity);
    }
  }
  function body() {
    return (
      <div className="page-stack erp-workspace">
        <PageHeader
          eyebrow={names[area]}
          title={area === "settings" ? "Workspace settings" : names[area]}
          description={descriptions[area]}
        >
          {config.create && canWrite && (
            <Button onClick={() => setCreate(true)}>
              <Plus className="size-4" />
              {config.create}
            </Button>
          )}
        </PageHeader>
        <nav
          className="erp-section-tabs"
          aria-label={names[area] + " sections"}
        >
          {tabs.map((t) => (
            <button
              type="button"
              aria-current={tab === t.key ? "page" : undefined}
              key={t.key}
              onClick={() => {
                router.replace(pathname + "?view=" + t.key, { scroll: false });
                setTab(t.key);
                setSearch("");
                setState("");
                setPage(1);
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {tab === "modules" ? (
          <div className="erp-module-cards">
            {erp.data?.modules.map((m) => (
              <article key={m.key}>
                <div>
                  <h2>{m.key[0].toUpperCase() + m.key.slice(1)}</h2>
                  <Status value={m.state} />
                </div>
                <p>
                  {m.key === "production"
                    ? "Finished-goods recording requires an active Warehouse."
                    : m.key === "quality"
                      ? "Inspections, lot release, and COAs."
                      : m.key === "warehouse"
                        ? "Stock, movements, counts, and dispatch."
                        : "Customers, quotations, and sales orders."}
                </p>
                <div className="erp-actions">
                  {(["active", "read_only", "disabled"] as const)
                    .filter((s) => s !== m.state)
                    .map((s) => (
                      <ERPActionButton
                        key={s}
                        action="set_module"
                        payload={{ module: m.key, state: s }}
                        onDone={() => {
                          erp.refresh();
                          result.refresh();
                        }}
                        destructive={s === "disabled"}
                      >
                        {s === "active"
                          ? "Activate"
                          : s === "read_only"
                            ? "Read-only"
                            : "Disable"}
                      </ERPActionButton>
                    ))}
                </div>
              </article>
            ))}
            <p className="erp-notice">
              Disabled modules block direct URLs, APIs, and new transactions.
              History is retained. Open work can prevent disabling; use
              read-only to pause operations.
            </p>
          </div>
        ) : (
          <>
            <div className="erp-toolbar">
              <Input
                aria-label="Search records"
                data-search-input
                placeholder="Search records…"
                value={search}
                maxLength={100}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                  listURL(e.target.value, state, 1);
                }}
              />
              {states[tab] && (
                <select
                  aria-label="Filter status"
                  value={state}
                  onChange={(e) => {
                    setState(e.target.value);
                    setPage(1);
                    listURL(search, e.target.value, 1);
                  }}
                >
                  <option value="">All statuses</option>
                  {states[tab].map((s) => (
                    <option key={s} value={s}>
                      {s.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              )}
              <span>
                {result.loading
                  ? "Loading…"
                  : `${result.data.total.toLocaleString("en-GB")} records`}
              </span>
              <Button variant="outline" size="sm" onClick={result.refresh}>
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={exporting}
                onClick={async () => {
                  setExporting(true);
                  try {
                    const r = await fetch(
                      "/api/erp/export/" +
                        tab +
                        "?" +
                        new URLSearchParams({ q: search, state }),
                    );
                    if (!r.ok) {
                      const e = await r.json();
                      throw Error(e.message);
                    }
                    const url = URL.createObjectURL(await r.blob()),
                      a = document.createElement("a");
                    a.href = url;
                    a.download = tab + ".csv";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 10000);
                  } catch (e) {
                    toast.error(
                      e instanceof Error ? e.message : "Export failed.",
                    );
                  } finally {
                    setExporting(false);
                  }
                }}
              >
                <FileDown className="size-3.5" />
                {exporting ? "Exporting…" : "CSV"}
              </Button>
            </div>
            {result.error ? (
              <div role="alert" className="erp-empty">
                <p>{result.error}</p>
                <Button onClick={result.refresh} variant="outline">
                  Retry
                </Button>
              </div>
            ) : (
              <div
                className={
                  "data-card" + (tab === "stock" ? " mobile-stock-cards" : "")
                }
              >
                <Table data-actions="true">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Record</TableHead>
                      <TableHead>
                        {tab === "stock"
                          ? "On hand"
                          : tab === "ledger"
                            ? "Change"
                            : tab === "catalog"
                              ? "Units"
                              : "Details"}
                      </TableHead>
                      <TableHead>
                        {tab === "stock" ? "Available" : "Status"}
                      </TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.loading ? (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <p className="erp-empty" role="status">
                            Loading records…
                          </p>
                        </TableCell>
                      </TableRow>
                    ) : result.data.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <div className="erp-empty">
                            <h2>
                              {search || state
                                ? "No matching records"
                                : "No records yet"}
                            </h2>
                            <p>
                              {search || state
                                ? "Try another search or clear your filters."
                                : "Create a record to start this workflow."}
                            </p>
                            {(search || state) && (
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setSearch("");
                                  setState("");
                                  setPage(1);
                                  listURL("", "", 1);
                                }}
                              >
                                Clear filters
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      result.data.rows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>
                            <button
                              type="button"
                              className="entity-name text-left"
                              onClick={() =>
                                setDetail({ entity: tab, id: row.id })
                              }
                            >
                              {identity(row)}
                            </button>
                            <p className="erp-row-description">
                              {summary(tab, row)}
                            </p>
                            <CopyValue
                              value={row.number || row.code || row.id}
                            />
                          </TableCell>
                          <TableCell
                            data-label={tab === "stock" ? "On hand" : undefined}
                          >
                            {tab === "stock"
                              ? `${decimal(row.on_hand)} ${row.unit}`
                              : tab === "ledger"
                                ? `${decimal(row.delta)} ${row.unit || ""}`
                                : tab === "catalog"
                                  ? row.units?.find((u) => u.is_base)?.code ||
                                    "Not configured"
                                  : row.date ||
                                    row.location ||
                                    row.contact ||
                                    row.code ||
                                    "—"}
                          </TableCell>
                          <TableCell
                            data-label={
                              tab === "stock" ? "Available" : undefined
                            }
                          >
                            {tab === "stock" ? (
                              <>
                                <strong>
                                  {decimal(row.available)} {row.unit}
                                </strong>
                                <p className="erp-row-description">
                                  {decimal(row.reserved)} reserved
                                </p>
                              </>
                            ) : row.state ? (
                              <Status value={row.display_state || row.state} />
                            ) : row.can_read !== undefined ? (
                              row.can_write ? (
                                "Can write"
                              ) : (
                                "Read only"
                              )
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <RowActions>
                              <button
                                type="button"
                                className="row-action"
                                aria-label="View record"
                                onClick={() =>
                                  setDetail({ entity: tab, id: row.id })
                                }
                              >
                                <Eye className="size-4" />
                              </button>
                            </RowActions>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
            <DataPagination
              count={result.data.rows.length}
              total={result.data.total}
              page={page}
              pageSize={50}
              loading={result.loading}
              onPageChange={(p) => {
                setPage(p);
                listURL(search, state, p);
              }}
            />
          </>
        )}
        {create && (
          <ERPModal
            title={config.create || "New record"}
            description={
              area === "production"
                ? "Record actual finished output, then review the draft before posting."
                : "Complete the details. Changes are validated on the server."
            }
            onClose={() => setCreate(false)}
          >
            {tab === "series" ? (
              <SeriesForm onDone={done} />
            ) : tab === "returns" ? (
              <ReturnForm onDone={done} />
            ) : tab === "quotes" ? (
              <QuoteForm onDone={done} />
            ) : tab === "customers" ? (
              <CustomerForm onDone={done} />
            ) : tab === "counts" ? (
              <CountForm onDone={done} />
            ) : tab === "movements" || tab === "production" ? (
              <MoveForm production={tab === "production"} onDone={done} />
            ) : config.action ? (
              <ConfigurationForm action={config.action} onDone={done} />
            ) : null}
          </ERPModal>
        )}
        {detail && (
          <RecordDetail
            key={detail.entity + detail.id + refresh}
            {...detail}
            onClose={() => setDetail(null)}
            onDone={done}
          />
        )}
      </div>
    );
  }
  if (area === "settings")
    return erp.data && !erp.data.admin ? (
      <div className="erp-empty">Administrator access required.</div>
    ) : (
      body()
    );
  return <ERPModuleGuard module={area as ModuleKey}>{body()}</ERPModuleGuard>;
}
function RecordDetail({
  entity,
  id,
  onClose,
  onDone,
}: {
  entity: string;
  id: string;
  onClose: () => void;
  onDone: (id?: string, entity?: string) => void;
}) {
  const result = useERPPage(entity, "", "", 1, id),
    row = result.data.rows[0],
    erp = useERP();
  const [edit, setEdit] = useState(false),
    [pdf, setPdf] = useState(false),
    [subForm, setSubForm] = useState<{
      type: string;
      line?: CountLine | OrderLine;
    } | null>(null),
    [customerRef, setCustomerRef] = useState("");
  const done = (nextId?: string, nextEntity?: string) => {
    setEdit(false);
    setSubForm(null);
    result.refresh();
    onDone(nextEntity ? nextId || id : id, nextEntity || entity);
  };
  const movement = ["movements", "production"].includes(entity),
    count = entity === "counts",
    quote = entity === "quotes",
    order = ["orders", "fulfillment"].includes(entity),
    customer = entity === "customers";
  const scope: ModuleKey =
      entity === "production"
        ? "production"
        : quote || entity === "orders" || customer
          ? "sales"
          : "warehouse",
    write = erp.can(scope, "write"),
    approve = erp.can(scope, "approve");
  const docURL = "/api/erp/documents/" + entity + "/" + id;
  return (
    <ERPModal
      title={row?.number || row?.product || row?.name || "Record details"}
      description={
        row?.state
          ? "Status: " + (row.display_state || row.state).replaceAll("_", " ")
          : "Review this record and its history."
      }
      onClose={onClose}
    >
      {result.loading ? (
        <p role="status">Loading details…</p>
      ) : result.error ? (
        <div role="alert">
          <p>{result.error}</p>
          <Button onClick={result.refresh}>Retry</Button>
        </div>
      ) : !row ? (
        <p>Record not found.</p>
      ) : (
        <>
          {entity === "lots" && <LotTrace row={row} onDone={done} />}
          {entity === "returns" && <ReturnDetail row={row} onDone={done} />}
          <div className="erp-detail-summary">
            {row.customer && (
              <p>
                <span>Customer</span>
                <strong>{row.customer}</strong>
              </p>
            )}
            {row.location && (
              <p>
                <span>Location</span>
                <strong>{row.location}</strong>
              </p>
            )}
            {row.date && (
              <p>
                <span>Date</span>
                <strong>{row.date}</strong>
              </p>
            )}
            {row.expiry_date && (
              <p>
                <span>Expiry</span>
                <strong>{row.expiry_date}</strong>
              </p>
            )}
            {row.reason && (
              <p>
                <span>Reference</span>
                <strong>{row.reason}</strong>
              </p>
            )}
            {row.assigned && (
              <p>
                <span>Assigned to</span>
                <strong>{row.assigned}</strong>
              </p>
            )}
          </div>
          <div className="erp-actions">
            {(movement || quote) && (
              <Button variant="outline" size="sm" onClick={() => setPdf(true)}>
                <Eye className="size-3.5" />
                Preview PDF
              </Button>
            )}
            {(movement || quote) && (
              <a
                className="erp-document-link"
                href={docURL + "?download=1"}
                download
              >
                <FileDown className="size-3.5" />
                Download PDF
              </a>
            )}
            {movement && row.state === "draft" && write && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={row.kind === "delivery"}
                  onClick={() => setEdit(true)}
                >
                  Edit draft
                </Button>
                <ERPActionButton
                  action="post_move"
                  payload={{ id, version: row.version }}
                  onDone={done}
                >
                  Post movement
                </ERPActionButton>
                <ERPActionButton
                  action="cancel_move"
                  payload={{ id }}
                  onDone={done}
                  reason
                  destructive
                >
                  Cancel draft
                </ERPActionButton>
              </>
            )}
            {movement &&
              row.state === "posted" &&
              approve &&
              row.kind !== "reversal" &&
              (row.kind !== "delivery" || erp.can("sales", "approve")) && (
                <ERPActionButton
                  action="reverse_move"
                  payload={{ id }}
                  onDone={done}
                  reason
                  destructive
                >
                  Reverse movement
                </ERPActionButton>
              )}
            {customer && write && (
              <Button size="sm" variant="outline" onClick={() => setEdit(true)}>
                Edit customer
              </Button>
            )}
            {quote && write && row.state === "draft" && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEdit(true)}
                >
                  Edit draft
                </Button>
                <ERPActionButton
                  action="issue_quote"
                  payload={{ id, version: row.version }}
                  onDone={done}
                >
                  Issue / request approval
                </ERPActionButton>
              </>
            )}
            {quote && approve && row.state === "pending" && (
              <>
                <ERPActionButton
                  action="approve_quote"
                  payload={{ id, version: row.version }}
                  onDone={done}
                  reason
                >
                  Approve quotation
                </ERPActionButton>
                <ERPActionButton
                  action="return_quote"
                  payload={{ id }}
                  onDone={done}
                  reason
                >
                  Return for changes
                </ERPActionButton>
              </>
            )}
            {quote &&
              write &&
              row.state === "issued" &&
              row.display_state !== "expired" && (
                <>
                  <ERPActionButton
                    action="accept_quote"
                    payload={{ id }}
                    onDone={done}
                  >
                    Mark accepted
                  </ERPActionButton>
                  <ERPActionButton
                    action="reject_quote"
                    payload={{ id }}
                    onDone={done}
                  >
                    Mark rejected
                  </ERPActionButton>
                </>
              )}
            {quote &&
              write &&
              ["issued", "rejected", "superseded"].includes(
                row.state || "",
              ) && (
                <ERPActionButton
                  action="revise_quote"
                  payload={{ id }}
                  onDone={done}
                >
                  Create revision
                </ERPActionButton>
              )}
            {quote &&
              write &&
              ["draft", "pending", "issued"].includes(row.state || "") && (
                <ERPActionButton
                  action="cancel_quote"
                  payload={{ id }}
                  onDone={done}
                  reason
                  destructive
                >
                  Cancel quotation
                </ERPActionButton>
              )}
            {count && approve && row.state === "draft" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSubForm({ type: "assign_count" })}
              >
                Assign counter
              </Button>
            )}
            {count && write && row.state === "draft" && (
              <ERPActionButton
                action="start_count"
                payload={{ id }}
                onDone={done}
              >
                Start count & freeze location
              </ERPActionButton>
            )}
            {count && write && row.state === "counting" && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSubForm({ type: "count_add" })}
                >
                  Add unlisted lot
                </Button>
                <ERPActionButton
                  action="submit_count"
                  payload={{ id }}
                  onDone={done}
                >
                  Submit count
                </ERPActionButton>
              </>
            )}
            {count && approve && row.state === "submitted" && (
              <ERPActionButton
                action="approve_count"
                payload={{ id }}
                onDone={done}
                reason
              >
                Approve adjustment
              </ERPActionButton>
            )}
            {count &&
              write &&
              ["draft", "counting", "submitted"].includes(row.state || "") && (
                <ERPActionButton
                  action="cancel_count"
                  payload={{ id }}
                  onDone={done}
                  reason
                  destructive
                >
                  Cancel count
                </ERPActionButton>
              )}
            {entity === "lots" &&
              erp.can("warehouse", "approve") &&
              erp.data?.modules.find((m) => m.key === "quality")?.state ===
                "disabled" && (
                <ERPActionButton
                  action="release_lot"
                  payload={{ id, release: row.qc_status !== "released" }}
                  onDone={done}
                  reason
                >
                  {row.qc_status === "released"
                    ? "Return to quarantine"
                    : "Approve manual release"}
                </ERPActionButton>
              )}
          </div>
          {quote && row.state === "accepted" && write && (
            <ERPForm
              action="convert_quote"
              payload={{ id, customer_reference: customerRef }}
              onDone={done}
              label="Create sales order"
            >
              <ERPField label="Customer reference (optional)">
                <Input
                  value={customerRef}
                  maxLength={1000}
                  onChange={(e) => setCustomerRef(e.target.value)}
                />
              </ERPField>
            </ERPForm>
          )}
          {(movement || quote) && (
            <div className="erp-detail-lines">
              {row.lines?.map((l, i) => (
                <article key={i}>
                  <div>
                    <h3>{l.product}</h3>
                    <p>
                      {l.code}
                      {l.lot ? " · " + l.lot : ""}
                    </p>
                  </div>
                  <strong>
                    {decimal(l.quantity || l.base_quantity)}{" "}
                    {l.unit || l.base_unit}
                  </strong>
                  {quote && (
                    <p>
                      {row.currency} {decimal(l.price)} per {l.unit} · Discount{" "}
                      {decimal(l.discount)}% · Amount {decimal(l.amount)}
                    </p>
                  )}
                  {movement &&
                    row.kind === "delivery" &&
                    ["posted", "reversed"].includes(row.state || "") &&
                    Boolean(
                      (row.snapshot?.lines as ERPLine[] | undefined)?.[i]?.coa,
                    ) && (
                      <a
                        href={docURL + "/coa/" + i + "?download=1"}
                        className="erp-document-link"
                        download
                      >
                        Download attached COA
                      </a>
                    )}
                </article>
              ))}
            </div>
          )}
          {quote && row.totals && (
            <div className="erp-totals">
              {Object.entries(row.totals).map(([k, v]) => (
                <p key={k}>
                  <span>{k}</span>
                  <strong>
                    {row.currency} {decimal(v)}
                  </strong>
                </p>
              ))}
            </div>
          )}
          {quote && (row.terms || row.delivery_terms || row.lead_time) && (
            <div className="erp-notice">
              {row.lead_time && <p>Lead time: {row.lead_time}</p>}
              {row.terms && <p>Terms: {row.terms}</p>}
              {row.delivery_terms && <p>Delivery: {row.delivery_terms}</p>}
            </div>
          )}
          {count && (
            <>
              <p className="erp-notice">
                {row.blind
                  ? "Blind count. System quantities are hidden on this count sheet while counting; approvers can review them."
                  : "System quantities are visible."}{" "}
                Counting/submitted locations are frozen until approved or
                cancelled.
              </p>
              <CountLines
                countId={id}
                editable={write && row.state === "counting"}
                onEntry={(line) => setSubForm({ type: "count_line", line })}
              />
            </>
          )}
          {order && (
            <>
              <div className="erp-actions">
                {row.state === "confirmed" && erp.can("warehouse", "write") && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSubForm({ type: "delivery" })}
                  >
                    Create delivery
                  </Button>
                )}
                {row.state === "confirmed" && erp.can("sales", "write") && (
                  <ERPActionButton
                    action="close_order"
                    payload={{ id }}
                    reason
                    destructive
                    onDone={done}
                  >
                    Close outstanding order
                  </ERPActionButton>
                )}
              </div>
              <div className="erp-detail-lines">
                {((row.lines as unknown as OrderLine[]) || []).map((l) => (
                  <article key={l.id}>
                    <h3>{l.product}</h3>
                    <p>
                      {decimal(l.quantity)} {l.unit} ordered ·{" "}
                      {decimal(l.delivered)} delivered · {decimal(l.reserved)}{" "}
                      reserved
                    </p>
                    {row.state === "confirmed" &&
                      erp.can("sales", "write") &&
                      erp.can("warehouse") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setSubForm({ type: "reserve", line: l })
                          }
                        >
                          Reserve stock
                        </Button>
                      )}
                  </article>
                ))}
              </div>
              <h3 className="erp-section-title">Reservations</h3>
              <div className="erp-detail-lines">
                {row.reservations?.map((r) => (
                  <article key={r.id}>
                    <h3>
                      {r.product} · {r.lot}
                    </h3>
                    <p>
                      {r.location} · {decimal(r.remaining)} {r.unit} remaining ·{" "}
                      {r.state}
                    </p>
                    {r.state === "active" && erp.can("sales", "write") && (
                      <ERPActionButton
                        action="unreserve"
                        payload={{ id: r.id }}
                        onDone={done}
                        reason
                      >
                        Release reservation
                      </ERPActionButton>
                    )}
                  </article>
                ))}
              </div>
              <h3 className="erp-section-title">Deliveries</h3>
              <div className="erp-detail-lines">
                {row.deliveries?.map((d) => (
                  <article key={d.id}>
                    <button
                      type="button"
                      className="entity-name"
                      onClick={() => onDone(d.id, "movements")}
                    >
                      {d.number}
                      <ArrowUpRight className="inline size-3.5" />
                    </button>
                    <Status value={d.state} />
                  </article>
                ))}
              </div>
            </>
          )}
          {entity === "stock" && (
            <div className="erp-detail-summary">
              <p>
                <span>Physical stock</span>
                <strong>
                  {decimal(row.on_hand)} {row.unit}
                </strong>
              </p>
              <p>
                <span>Reserved</span>
                <strong>
                  {decimal(row.reserved)} {row.unit}
                </strong>
              </p>
              <p>
                <span>Available to sell</span>
                <strong>
                  {decimal(row.available)} {row.unit}
                </strong>
              </p>
              <p>
                <span>QC status</span>
                <strong>{row.qc_status}</strong>
              </p>
            </div>
          )}
          {customer && (
            <div className="erp-detail-summary">
              {(
                [
                  "contact",
                  "email",
                  "phone",
                  "tax_id",
                  "billing_address",
                  "shipping_address",
                  "payment_terms",
                ] as const
              ).map((k) => (
                <p key={k}>
                  <span>{k.replaceAll("_", " ")}</span>
                  <strong>{row[k] || "—"}</strong>
                </p>
              ))}
            </div>
          )}
          {entity === "catalog" && (
            <div className="erp-detail-lines">
              {row.units?.map((u) => (
                <article key={u.id}>
                  <h3>
                    {u.code}
                    {u.is_base ? " · base unit" : ""}
                  </h3>
                  <p>Conversion factor: {decimal(u.factor)}</p>
                </article>
              ))}
            </div>
          )}
          {edit && (
            <ERPModal
              title={
                quote
                  ? "Edit quotation"
                  : customer
                    ? "Edit customer"
                    : "Edit movement"
              }
              description="Only drafts can be changed. Server versions prevent stale updates."
              onClose={() => setEdit(false)}
            >
              {quote ? (
                <QuoteForm row={row} onDone={done} />
              ) : customer ? (
                <CustomerForm row={row} onDone={done} />
              ) : (
                <MoveForm
                  row={row}
                  production={row.kind === "production"}
                  onDone={done}
                />
              )}
            </ERPModal>
          )}
          {subForm && (
            <ERPModal
              title={
                {
                  count_line: "Enter physical count",
                  count_add: "Add unlisted lot",
                  reserve: "Reserve stock",
                  delivery: "Create delivery",
                }[subForm.type] || "Details"
              }
              description="Quantities are validated against the current server state."
              onClose={() => setSubForm(null)}
            >
              {subForm.type === "assign_count" ? (
                <AssignCountForm id={id} onDone={done} />
              ) : subForm.type === "count_line" ? (
                <CountEntryForm
                  countId={id}
                  line={subForm.line as CountLine}
                  onDone={done}
                />
              ) : subForm.type === "count_add" ? (
                <CountAddForm id={id} onDone={done} />
              ) : subForm.type === "reserve" ? (
                <ReserveForm line={subForm.line as OrderLine} onDone={done} />
              ) : (
                <DeliveryForm row={row} onDone={done} />
              )}
            </ERPModal>
          )}
          {pdf && (
            <ERPModal
              title="Document preview"
              description={
                row.state === "draft" || row.state === "pending"
                  ? "Draft preview. Not an issued document."
                  : "Generated from the recorded document snapshot."
              }
              onClose={() => setPdf(false)}
            >
              <a
                href={docURL}
                target="_blank"
                rel="noopener noreferrer"
                className="erp-document-link"
              >
                Open PDF in a new tab
                <ExternalLink className="size-3.5" />
              </a>
              <iframe
                title="Document PDF preview"
                src={docURL + "#toolbar=0"}
                className="erp-pdf-frame"
              />
            </ERPModal>
          )}
        </>
      )}
    </ERPModal>
  );
}
export function OperationsHome() {
  const erp = useERP();
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Overview"
        title="Your operation"
        description="Choose a workspace to continue today's work."
      />
      <div className="erp-module-cards">
        {(["production", "warehouse", "sales"] as const)
          .filter((m) => erp.can(m))
          .map((m) => (
            <Link key={m} href={"/dashboard/" + m}>
              <h2>{names[m]}</h2>
              <p>{descriptions[m]}</p>
              <span>
                Open workspace <ArrowUpRight className="inline size-4" />
              </span>
            </Link>
          ))}
      </div>
      {erp.error && <p role="alert">{erp.error}</p>}
    </div>
  );
}

function CountLines({
  countId,
  editable,
  onEntry,
}: {
  countId: string;
  editable: boolean;
  onEntry: (line: CountLine) => void;
}) {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [state, setState] = useState("");
  const result = useERPPage("count_lines", q, state, page, countId);
  return (
    <div>
      <div className="erp-toolbar">
        <Input
          aria-label="Search count lines"
          placeholder="Find product or lot…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Count entry status"
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All lines</option>
          <option value="uncounted">Not counted</option>
          <option value="counted">Counted</option>
        </select>
      </div>
      <div className="erp-detail-lines">
        {result.loading ? (
          <p role="status">Loading count lines…</p>
        ) : result.error ? (
          <p role="alert">{result.error}</p>
        ) : (
          (result.data.rows as unknown as CountLine[]).map((l) => (
            <article key={l.lot_id}>
              <h3>
                {l.product} · {l.lot}
              </h3>
              <p>
                Counted: {decimal(l.counted)} {l.unit}
                {l.baseline !== null
                  ? ` · System: ${decimal(l.baseline)} · Difference: ${decimal(l.difference)}`
                  : ""}
              </p>
              {editable && (
                <Button size="sm" variant="outline" onClick={() => onEntry(l)}>
                  Enter count
                </Button>
              )}
            </article>
          ))
        )}
      </div>
      <DataPagination
        count={result.data.rows.length}
        total={result.data.total}
        page={page}
        pageSize={50}
        loading={result.loading}
        onPageChange={setPage}
      />
    </div>
  );
}
