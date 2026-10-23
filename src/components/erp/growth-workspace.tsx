"use client";
import { useWorkPosition } from "@/components/workspace/use-work-position";
import { useOperatorState } from "@/components/workspace/form-recovery";
import { useTableState } from "@/components/tables/use-table-state";
import { AdvancedRecordsTable } from "@/components/tables/advanced-records-table";
import { money, units, decimalUnits } from "@/lib/erp/ux";
import { TransactionControls } from "./transaction-controls";
import { DocumentFlow } from "./document-flow";
import { ModuleInsights } from "./module-insights";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, ArrowUpRight, Pencil } from "lucide-react";
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
import {
  PageHeader,
  DataToolbar,
  DataPagination,
} from "@/components/workspace/page-ui";
import { RowActions } from "@/components/workspace/row-actions";
import { CopyValue, useSearchSeed } from "@/components/workspace/data-tools";
import { useUser } from "@/app/(dashboard)/user-context";
import { businessDate as todayISO } from "@/lib/domain/validation";
import { decimal, type ERPRow, type ERPAction } from "@/lib/erp/schema";
import { useERP } from "./context";
import { useERPPage } from "./data";
import { ERPPicker } from "./picker";
import {
  ERPModuleGuard,
  ERPModal,
  ERPForm,
  ERPField,
  ERPActionButton,
} from "./shared";

type Area = "purchase" | "crm" | "documents" | "materials";
type PurchaseLine = {
  id: string;
  material_id: string;
  name: string;
  code: string;
  unit: string;
  quantity: string;
  price: string;
  received: string;
  outstanding: string;
};
type Activity = {
  id: string;
  title: string;
  kind: string;
  due_date: string;
  state: string;
  assignee: string;
  notes: string;
};
type RecordRow = Omit<ERPRow, "lines"> & {
  transaction_id?: string;
  reversed?: boolean;
  supplier_id?: string;
  supplier?: string;
  expected_date?: string;
  total?: string;
  active?: boolean;
  unit_id?: string;
  minimum_stock?: string;
  address?: string;
  company?: string;
  owner_id?: string;
  owner?: string;
  expected_value?: string;
  probability?: number;
  expected_close?: string;
  stage?: string;
  notes?: string;
  loss_reason?: string;
  opportunity_id?: string;
  opportunity?: string;
  assignee?: string;
  material_id?: string;
  kind?: string;
  language?: string;
  file_url?: string;
  effective_date?: string;
  activities?: Activity[];
  quotes?: { id: string; number: string; state: string }[];
  lines?: PurchaseLine[];
};
type Field = {
  key: string;
  label: string;
  type?: "date" | "number" | "email" | "url" | "textarea" | "picker" | "select";
  entity?: string;
  options?: string[];
  optional?: boolean;
};
const sections = {
  purchase: [
    {
      key: "purchases",
      label: "Purchase orders",
      create: "New purchase order",
    },
    { key: "suppliers", label: "Suppliers", create: "New supplier" },
    { key: "materials", label: "Raw materials", create: "New material" },
  ],
  crm: [
    { key: "opportunities", label: "Pipeline", create: "New opportunity" },
    { key: "crm_activities", label: "Activities", create: "Schedule activity" },
  ],
  documents: [
    {
      key: "product_documents",
      label: "Product documents",
      create: "New document",
    },
  ],
  materials: [
    {
      key: "material_stock",
      label: "Material stock",
      create: "Issue material",
    },
    { key: "material_ledger", label: "Material ledger", create: "" },
  ],
};
const names = {
  purchase: "Purchase",
  crm: "CRM",
  documents: "Product documents",
  materials: "Raw materials",
};
const descriptions = {
  purchase: "Suppliers, purchase orders and lot-based receiving.",
  crm: "Keep every prospect and next conversation moving.",
  documents: "Controlled revisions, product references and expiry dates.",
  materials: "Track incoming materials, available lots and consumption.",
};
const states: Record<string, string[]> = {
  purchases: [
    "draft",
    "confirmed",
    "partial",
    "received",
    "closed",
    "cancelled",
  ],
  suppliers: ["active", "inactive"],
  materials: ["active", "low_stock", "inactive"],
  opportunities: ["lead", "qualified", "proposal", "won", "lost"],
  crm_activities: ["open", "overdue", "done", "cancelled"],
  product_documents: [
    "draft",
    "valid",
    "expiring",
    "expired",
    "superseded",
    "withdrawn",
  ],
  material_stock: ["available", "expiring", "expired"],
  material_ledger: ["receipt", "issue", "reversal"],
};
const actions: Record<string, ERPAction> = {
  purchases: "save_purchase",
  suppliers: "save_supplier",
  materials: "save_material",
  opportunities: "save_opportunity",
  crm_activities: "save_crm_activity",
  product_documents: "save_product_document",
  material_stock: "issue_material",
};
const contact: Field[] = [
  { key: "contact", label: "Contact person", optional: true },
  { key: "email", label: "Email", type: "email", optional: true },
  { key: "phone", label: "Phone", optional: true },
];
const configs: Record<string, Field[]> = {
  suppliers: [
    { key: "name", label: "Supplier name" },
    ...contact,
    { key: "address", label: "Address", type: "textarea", optional: true },
    { key: "tax_id", label: "Tax ID", optional: true },
    { key: "payment_terms", label: "Payment terms", optional: true },
    {
      key: "active",
      label: "Status",
      type: "select",
      options: ["active", "inactive"],
    },
  ],
  materials: [
    { key: "code", label: "Material code" },
    { key: "name", label: "Material name" },
    { key: "unit_id", label: "Base unit", type: "picker", entity: "units" },
    { key: "minimum_stock", label: "Minimum stock", type: "number" },
    {
      key: "active",
      label: "Status",
      type: "select",
      options: ["active", "inactive"],
    },
  ],
  purchases: [
    {
      key: "supplier_id",
      label: "Supplier",
      type: "picker",
      entity: "suppliers",
    },
    { key: "date", label: "Order date", type: "date" },
    { key: "expected_date", label: "Expected receipt", type: "date" },
    { key: "currency", label: "Currency" },
    { key: "terms", label: "Terms", type: "textarea", optional: true },
  ],
  opportunities: [
    { key: "title", label: "Opportunity title" },
    { key: "company", label: "Company" },
    ...contact,
    { key: "owner_id", label: "Owner", type: "picker", entity: "crm_owners" },
    { key: "source", label: "Lead source", optional: true },
    { key: "expected_value", label: "Expected value", type: "number" },
    { key: "currency", label: "Currency" },
    { key: "probability", label: "Probability (%)", type: "number" },
    {
      key: "expected_close",
      label: "Expected close",
      type: "date",
      optional: true,
    },
    { key: "notes", label: "Notes", type: "textarea", optional: true },
  ],
  crm_activities: [
    {
      key: "opportunity_id",
      label: "Opportunity",
      type: "picker",
      entity: "opportunities",
    },
    { key: "title", label: "Activity title" },
    {
      key: "kind",
      label: "Type",
      type: "select",
      options: ["call", "email", "meeting", "task"],
    },
    { key: "due_date", label: "Due date", type: "date" },
    {
      key: "assigned_to",
      label: "Assigned to",
      type: "picker",
      entity: "crm_owners",
    },
    { key: "notes", label: "Notes", type: "textarea", optional: true },
  ],
  product_documents: [
    { key: "product_id", label: "Product", type: "picker", entity: "catalog" },
    {
      key: "kind",
      label: "Document type",
      type: "select",
      options: ["SDS", "TDS", "HALAL", "ISO", "OTHER"],
    },
    {
      key: "language",
      label: "Language",
      type: "select",
      options: ["en", "id"],
    },
    { key: "title", label: "Title" },
    { key: "file_url", label: "Document link (HTTPS)", type: "url" },
    { key: "effective_date", label: "Effective date", type: "date" },
    { key: "expiry_date", label: "Expiry date", type: "date", optional: true },
    { key: "notes", label: "Notes", type: "textarea", optional: true },
  ],
  material_stock: [
    {
      key: "stock",
      label: "Material lot / location",
      type: "picker",
      entity: "material_stock",
    },
    { key: "quantity", label: "Quantity", type: "number" },
    { key: "date", label: "Issue date", type: "date" },
    {
      key: "reason",
      label: "Consumption reference / reason",
      type: "textarea",
    },
  ],
};
function text(value: unknown) {
  return value == null ? "" : String(value);
}
function label(value?: string) {
  return value?.replaceAll("_", " ") || "—";
}
function Selector({
  field,
  value,
  onChange,
  id,
  name,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
}: {
  id?: string;
  name?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  field: Field;
  value: ERPRow | null;
  onChange: (r: ERPRow) => void;
}) {
  return (
    <ERPPicker
      hideLabel
      id={id}
      name={name}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      entity={field.entity!}
      label={field.label}
      value={value}
      onChange={onChange}
    />
  );
}

export function GrowthWorkspace({ area }: { area: Area }) {
  const params = useSearchParams();
  return (
    <GrowthView
      key={[
        area,
        params.get("view"),
        params.get("product"),
        params.get("q"),
      ].join(":")}
      area={area}
    />
  );
}
function GrowthView({ area }: { area: Area }) {
  const params = useSearchParams(),
    router = useRouter(),
    erp = useERP();
  const available = sections[area],
    tab = available.find((t) => t.key === params.get("view")) || available[0];
  const [q, setQ] = useState(params.get("q") || ""),
    [state, setState] = useState(params.get("state") || ""),
    [page, setPage] = useState(1),
    [selection, setSelection] = useState<RecordRow | null>(null),
    [linkedId, setLinkedId] = useState(params.get("record")),
    [form, setForm] = useState<{
      entity: string;
      row?: RecordRow;
      mode?: string;
    } | null>(null);
  const positionReady = useWorkPosition(
    tab.key,
    { q, state, page },
    (saved) => {
      setQ(saved.q);
      setState(saved.state);
      setPage(saved.page);
    },
  );
  useSearchSeed((query) => {
    setQ(query);
    setPage(1);
  });
  const scope = area === "materials" ? "warehouse" : area;
  const canRead = erp.can(scope),
    write = erp.can(scope, "write"),
    approve = erp.can(scope, "approve");
  const productFilter =
    area === "documents" && params.get("product")
      ? "product:" + params.get("product")
      : undefined;
  const table = useTableState(tab.key, () => setPage(1));
  const result = useERPPage(
    tab.key,
    q,
    state,
    page,
    productFilter,
    canRead && table.ready && positionReady,
    undefined,
    table.query,
  );
  const linked = useERPPage(
    tab.key,
    "",
    "",
    1,
    linkedId || undefined,
    Boolean(linkedId && canRead),
  );
  const selected =
    selection || (linked.data.rows[0] as RecordRow | undefined) || null;
  function setSelected(row: RecordRow | null) {
    setLinkedId(null);
    setSelection(row);
  }
  function done() {
    setForm(null);
    setSelected(null);
    result.refresh();
  }
  function changeTab(key: string) {
    setState("");
    setQ("");
    setPage(1);
    setSelected(null);
    router.push(`?view=${key}`, { scroll: false });
  }
  function edit(row: RecordRow) {
    setSelected(null);
    setForm({ entity: tab.key, row });
  }
  function body() {
    return (
      <div className="page-stack erp-workspace">
        <PageHeader
          eyebrow="OPERATIONS"
          title={names[area]}
          description={descriptions[area]}
        >
          {write && tab.create && (
            <Button
              onClick={() =>
                setForm({
                  entity: tab.key,
                  ...(area === "documents" && params.get("product")
                    ? {
                        row: {
                          id: "",
                          product_id: params.get("product")!,
                          product: "Selected product",
                        },
                      }
                    : {}),
                })
              }
            >
              <Plus className="size-4" />
              {tab.create}
            </Button>
          )}
        </PageHeader>
        {available.length > 1 && (
          <nav className="erp-section-tabs" aria-label={`${names[area]} views`}>
            {available.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-current={t.key === tab.key ? "page" : undefined}
                onClick={() => changeTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        )}
        <ModuleInsights module={scope} />
        {area === "crm" && tab.key === "opportunities" && (
          <div className="crm-stage-strip" aria-label="Pipeline stages">
            {states.opportunities.map((s) => (
              <button
                type="button"
                key={s}
                aria-pressed={state === s}
                onClick={() => {
                  setState(state === s ? "" : s);
                  setPage(1);
                }}
              >
                {label(s)}
              </button>
            ))}
          </div>
        )}
        {area === "documents" && params.get("product") && (
          <p className="growth-context-note">
            Filtered to one product.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => {
                setQ("");
                setPage(1);
                router.replace("/dashboard/product-documents");
              }}
            >
              Show all products
            </button>
          </p>
        )}
        {area === "documents" && (
          <p className="growth-context-note">
            Expiry alerts use a 30-day window. Published revision details are
            locked; create a new revision to replace them.
          </p>
        )}
        {area === "materials" && (
          <p className="growth-context-note">
            Quantities use each material’s base unit. Receipts come from
            Purchase; issues record manual consumption.
          </p>
        )}
        <DataToolbar
          search={q}
          onSearch={(v) => {
            setQ(v);
            setPage(1);
          }}
          placeholder={`Search ${tab.label.toLowerCase()}…`}
          total={result.data.total}
          loading={result.loading}
          onRefresh={result.refresh}
          filter={
            <select
              aria-label="Filter status"
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {states[tab.key].map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          }
        />
        <div className="growth-list-heading">
          <h2>{tab.label}</h2>
        </div>
        {result.error ? (
          <div role="alert" className="erp-empty">
            <p>{result.error}</p>
            <Button onClick={result.refresh} variant="outline">
              Retry
            </Button>
          </div>
        ) : result.loading ? (
          <p role="status" className="erp-empty">
            Loading records…
          </p>
        ) : !result.data.rows.length ? (
          <div className="erp-empty">
            <h3>No records found</h3>
            <p>
              {q || state
                ? "Try another search or status."
                : "Create your first record to get started."}
            </p>
          </div>
        ) : (
          <div className="table-frame mobile-stock-cards growth-records">
            <AdvancedRecordsTable
              summary={result.data.summary}
              state={table}
              rows={result.data.rows}
              search={q}
              status={state}
              onRestore={(q, s) => {
                setQ(q);
                setState(s);
                setPage(1);
              }}
              exportURL={
                "/api/erp/export/" +
                tab.key +
                "?" +
                new URLSearchParams({
                  q: q,
                  state: state,
                  ...(productFilter ? { id: productFilter } : {}),
                })
              }
            >
              <Table data-actions>
                <TableHeader>
                  <TableRow>
                    <TableHead>Record</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(result.data.rows as RecordRow[]).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <button
                          className="growth-record-link"
                          onClick={() => setSelected(row)}
                        >
                          {row.number || row.code || row.title || row.name}
                        </button>
                        <p className="growth-record-subtitle">
                          {row.title || row.name || row.company || row.supplier}
                        </p>
                        {row.number && <CopyValue value={row.number} />}
                      </TableCell>
                      <TableCell data-label="Details">
                        <RowDetails row={row} entity={tab.key} />
                      </TableCell>
                      <TableCell data-label="Status">
                        <Badge variant="outline">
                          {label(row.display_state || row.state)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <RowActions
                          label={`Actions for ${row.number || row.name || row.title}`}
                        >
                          <button
                            type="button"
                            className="row-action"
                            onClick={() => setSelected(row)}
                          >
                            View details
                          </button>
                        </RowActions>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </AdvancedRecordsTable>
          </div>
        )}
        <DataPagination
          page={page}
          pageSize={result.data.page_size}
          total={result.data.total}
          onPageChange={setPage}
          count={result.data.rows.length}
          loading={result.loading}
        />
        {linkedId && linked.loading && !selection && (
          <ERPModal
            layout="record"
            loading
            title="Record details"
            description="Loading the complete record."
            onClose={() => setSelected(null)}
          >
            <span />
          </ERPModal>
        )}
        {selected && (
          <ERPModal
            layout="record"
            title={
              selected.number ||
              selected.name ||
              selected.title ||
              "Record details"
            }
            description={tab.label}
            onClose={() => setSelected(null)}
          >
            <div className="growth-detail">
              <>
                {tab.key === "purchases" && (
                  <>
                    <TransactionControls
                      entity="purchases"
                      id={selected.id}
                      currency={text(selected.currency) || "IDR"}
                      onDone={done}
                    />
                    <DocumentFlow entity="purchases" id={selected.id} />
                  </>
                )}
                <RecordDetail row={selected} entity={tab.key} />
              </>
              <div className="growth-detail-actions">
                {tab.key === "material_ledger" &&
                  selected.kind !== "reversal" &&
                  !selected.reversed &&
                  approve &&
                  (selected.kind !== "receipt" ||
                    erp.can("purchase", "approve")) && (
                    <ERPActionButton
                      action="reverse_material_transaction"
                      payload={{ id: selected.transaction_id }}
                      reason
                      onDone={done}
                    >
                      Reverse transaction
                    </ERPActionButton>
                  )}
                {tab.key === "purchases" && (
                  <a
                    className="erp-document-link"
                    href={`/api/erp/documents/purchases/${selected.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Preview purchase order PDF
                    <ArrowUpRight className="size-4" />
                  </a>
                )}
                {write && ["suppliers", "materials"].includes(tab.key) && (
                  <Button variant="outline" onClick={() => edit(selected)}>
                    <Pencil />
                    Edit
                  </Button>
                )}
                {(write || approve || erp.can("warehouse", "write")) &&
                  tab.key === "purchases" && (
                    <>
                      {write && selected.state === "draft" && (
                        <Button
                          variant="outline"
                          onClick={() => edit(selected)}
                        >
                          Edit draft
                        </Button>
                      )}
                      {selected.state === "draft" && approve && (
                        <ERPActionButton
                          action="confirm_purchase"
                          payload={{
                            id: selected.id,
                            version: selected.version,
                          }}
                          onDone={done}
                        >
                          Confirm purchase
                        </ERPActionButton>
                      )}
                      {["confirmed", "partial"].includes(
                        selected.state || "",
                      ) &&
                        erp.can("warehouse", "write") && (
                          <Button
                            onClick={() => {
                              setForm({
                                entity: "purchases",
                                row: selected,
                                mode: "receive",
                              });
                              setSelected(null);
                            }}
                          >
                            Receive materials
                          </Button>
                        )}
                      {["draft", "confirmed"].includes(selected.state || "") &&
                        ((selected.state === "draft" && write) ||
                          (selected.state !== "draft" && approve)) && (
                          <ERPActionButton
                            action="cancel_purchase"
                            payload={{
                              id: selected.id,
                              version: selected.version,
                            }}
                            reason
                            onDone={done}
                          >
                            Cancel outstanding
                          </ERPActionButton>
                        )}
                    </>
                  )}
                {write && tab.key === "opportunities" && (
                  <>
                    {!["won", "lost"].includes(selected.state || "") && (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => edit(selected)}
                        >
                          Edit opportunity
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setForm({
                              entity: "crm_activities",
                              row: {
                                id: "",
                                opportunity_id: selected.id,
                                title: "",
                                company: selected.title,
                              },
                            });
                            setSelected(null);
                          }}
                        >
                          Schedule activity
                        </Button>
                      </>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => {
                        setForm({
                          entity: "opportunities",
                          row: selected,
                          mode: "stage",
                        });
                        setSelected(null);
                      }}
                    >
                      Change stage
                    </Button>
                    {!selected.customer_id &&
                      selected.state !== "lost" &&
                      erp.can("sales", "write") && (
                        <Button
                          onClick={() => {
                            setForm({
                              entity: "opportunities",
                              row: selected,
                              mode: "convert",
                            });
                            setSelected(null);
                          }}
                        >
                          Link customer
                        </Button>
                      )}
                    {selected.customer_id &&
                      erp.can("sales", "write") &&
                      selected.state !== "lost" && (
                        <Link
                          className="erp-document-link"
                          href={`/dashboard/sales?view=quotes&customer=${selected.customer_id}&opportunity=${selected.id}`}
                        >
                          Create quotation
                          <ArrowUpRight className="size-4" />
                        </Link>
                      )}
                  </>
                )}
                {write &&
                  tab.key === "crm_activities" &&
                  selected.state === "open" && (
                    <ERPActionButton
                      action="complete_crm_activity"
                      payload={{
                        id: selected.id,
                        state: "done",
                        notes: selected.notes || "",
                      }}
                      onDone={done}
                    >
                      Complete activity
                    </ERPActionButton>
                  )}
                {(write || approve) && tab.key === "product_documents" && (
                  <>
                    {write && selected.state === "draft" && (
                      <Button variant="outline" onClick={() => edit(selected)}>
                        Edit draft
                      </Button>
                    )}
                    {write && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setForm({
                            entity: "product_documents",
                            row: {
                              ...selected,
                              id: "",
                              version: undefined,
                              state: "draft",
                            },
                          });
                          setSelected(null);
                        }}
                      >
                        New revision
                      </Button>
                    )}
                    {selected.state === "draft" && approve && (
                      <ERPActionButton
                        action="publish_product_document"
                        payload={{ id: selected.id, version: selected.version }}
                        onDone={done}
                      >
                        Publish revision
                      </ERPActionButton>
                    )}
                    {["draft", "published"].includes(selected.state || "") &&
                      approve && (
                        <ERPActionButton
                          action="withdraw_product_document"
                          payload={{
                            id: selected.id,
                            version: selected.version,
                          }}
                          reason
                          onDone={done}
                        >
                          Withdraw document
                        </ERPActionButton>
                      )}
                  </>
                )}
              </div>
            </div>
          </ERPModal>
        )}
        {form && (
          <ERPModal
            title={
              form.mode === "receive"
                ? "Receive materials"
                : form.mode === "stage"
                  ? "Change stage"
                  : form.mode === "convert"
                    ? "Link customer"
                    : form.row?.id
                      ? "Edit record"
                      : form.entity === "product_documents" && form.row
                        ? "New document revision"
                        : tab.create || "New record"
            }
            description="Changes are validated and recorded in the audit log."
            onClose={() => setForm(null)}
          >
            <GrowthForm
              entity={form.entity}
              row={form.row}
              mode={form.mode}
              onDone={done}
            />
          </ERPModal>
        )}
      </div>
    );
  }
  return <ERPModuleGuard module={scope}>{body()}</ERPModuleGuard>;
}
function RowDetails({ row: r, entity }: { row: RecordRow; entity: string }) {
  if (entity === "purchases")
    return (
      <>
        <p>{r.supplier}</p>
        <small>
          {r.expected_date} · {r.currency} {decimal(r.total)}
        </small>
      </>
    );
  if (entity === "opportunities")
    return (
      <>
        <p>{r.company}</p>
        <small>
          {r.owner} · {r.currency} {decimal(r.expected_value)}
        </small>
      </>
    );
  if (entity === "product_documents")
    return (
      <>
        <p>{r.product}</p>
        <small>
          {r.kind} · {r.language?.toUpperCase()} · Rev {r.revision}
          <br />
          {r.expiry_date ? `Expires ${r.expiry_date}` : "No expiry"}
        </small>
      </>
    );
  if (entity === "material_stock" || entity === "material_ledger")
    return (
      <>
        <p>{r.lot_number}</p>
        <small>
          {r.location} · {decimal(r.quantity)} {r.unit}
        </small>
      </>
    );
  if (entity === "materials")
    return (
      <>
        <p>
          {decimal(r.on_hand)} {r.unit} on hand
        </p>
        <small>
          Minimum {decimal(r.minimum_stock)} {r.unit}
        </small>
      </>
    );
  if (entity === "crm_activities")
    return (
      <>
        <p>{r.opportunity}</p>
        <small>
          {r.due_date} · {r.assignee}
        </small>
      </>
    );
  return (
    <>
      <p>{r.contact || "—"}</p>
      <small>{r.email || r.phone}</small>
    </>
  );
}
const detailKeys: Record<string, string[]> = {
  suppliers: [
    "name",
    "contact",
    "email",
    "phone",
    "address",
    "tax_id",
    "payment_terms",
    "active",
  ],
  materials: [
    "code",
    "name",
    "unit",
    "on_hand",
    "available",
    "minimum_stock",
    "active",
  ],
  purchases: [
    "supplier",
    "date",
    "expected_date",
    "currency",
    "total",
    "terms",
    "reason",
  ],
  opportunities: [
    "title",
    "company",
    "owner",
    "stage",
    "expected_value",
    "currency",
    "probability",
    "expected_close",
    "source",
    "contact",
    "email",
    "phone",
    "customer",
    "loss_reason",
    "notes",
  ],
  crm_activities: [
    "title",
    "opportunity",
    "company",
    "kind",
    "due_date",
    "assignee",
    "display_state",
    "notes",
  ],
  product_documents: [
    "product",
    "kind",
    "language",
    "revision",
    "effective_date",
    "expiry_date",
    "display_state",
    "notes",
    "reason",
  ],
  material_stock: [
    "name",
    "code",
    "lot_number",
    "supplier",
    "location",
    "quantity",
    "unit",
    "expiry_date",
    "state",
  ],
  material_ledger: [
    "number",
    "kind",
    "name",
    "code",
    "lot_number",
    "location",
    "quantity",
    "unit",
    "date",
    "purchase",
    "reason",
    "reversed",
  ],
};
function RecordDetail({ row: r, entity }: { row: RecordRow; entity: string }) {
  return (
    <>
      <dl className="growth-facts">
        {(detailKeys[entity] || [])
          .filter(
            (k) =>
              (r as Record<string, unknown>)[k] != null &&
              (r as Record<string, unknown>)[k] !== "",
          )
          .map((k) => {
            const value = (r as Record<string, unknown>)[k];
            const formatted = [
              "total",
              "expected_value",
              "minimum_stock",
              "quantity",
              "on_hand",
            ].includes(k)
              ? decimal(text(value))
              : k === "probability"
                ? decimal(text(value)) + "%"
                : typeof value === "boolean"
                  ? value
                    ? "Yes"
                    : "No"
                  : text(value);
            return (
              <div key={k}>
                <dt>{k === "display_state" ? "Status" : label(k)}</dt>
                <dd>{formatted}</dd>
              </div>
            );
          })}
      </dl>
      {entity === "product_documents" && r.file_url && (
        <a
          className="erp-document-link"
          href={r.file_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open document
          <ArrowUpRight className="size-4" />
        </a>
      )}
      {entity === "purchases" && (
        <div className="growth-lines">
          {((r.lines as PurchaseLine[]) || []).map((l) => (
            <div className="growth-line-summary" key={l.id}>
              <strong>
                {l.code} · {l.name}
              </strong>
              <span>
                Ordered {decimal(l.quantity)} {l.unit} · Received{" "}
                {decimal(l.received)} · Outstanding {decimal(l.outstanding)}
              </span>
              <small>
                Unit price {r.currency} {decimal(l.price)}
              </small>
            </div>
          ))}
        </div>
      )}
      {entity === "opportunities" && (
        <>
          <h3>Follow-up history</h3>
          {!r.activities?.length && (
            <p className="text-sm text-muted">No activities yet.</p>
          )}
          {r.activities?.map((a) => (
            <div className="growth-line-summary" key={a.id}>
              <strong>{a.title}</strong>
              <span>
                {a.kind} · {a.due_date} · {a.assignee} · {a.state}
              </span>
              {a.notes && <small>{a.notes}</small>}
            </div>
          ))}
          <h3>Linked quotations</h3>
          {!r.quotes?.length && (
            <p className="text-sm text-muted">No linked quotations.</p>
          )}
          {r.quotes?.map((q) => (
            <Link
              key={q.id}
              className="erp-document-link"
              href={`/dashboard/sales?view=quotes&q=${encodeURIComponent(q.number)}`}
            >
              {q.number} · {q.state}
            </Link>
          ))}
        </>
      )}
    </>
  );
}

function GrowthForm({
  entity,
  row,
  mode,
  onDone,
}: {
  entity: string;
  row?: RecordRow;
  mode?: string;
  onDone: () => void;
}) {
  const { user } = useUser();
  const erp = useERP();
  const [holdReceipt, setHoldReceipt] = useOperatorState(
    `GrowthForm:${entity}:${mode}:holdReceipt`,
    false,
  );
  const [requestKey] = useOperatorState(
    `GrowthForm:${entity}:${mode}:requestKey`,
    () => crypto.randomUUID(),
  );
  const [value, setValue] = useOperatorState<Record<string, string>>(
    `GrowthForm:${entity}:${mode}:value`,
    () => {
      const defaults: Record<string, string> = {
        date: todayISO(),
        expected_date: todayISO(),
        due_date: todayISO(),
        effective_date: todayISO(),
        expiry_date: "",
        currency: "IDR",
        minimum_stock: "0",
        expected_value: "0",
        probability: "10",
        kind: entity === "product_documents" ? "SDS" : "call",
        language: "en",
        active: "active",
        owner_id: user?.id || "",
        assigned_to: user?.id || "",
        stage: row?.state || "lead",
        reason: "",
        notes: "",
        contact: "",
        email: "",
        phone: "",
        source: "",
        terms: "",
        address: "",
        tax_id: "",
        payment_terms: "",
        expected_close: "",
      };
      for (const [k, v] of Object.entries(row || {}))
        if (v != null && typeof v !== "object") defaults[k] = String(v);
      defaults.active = row?.active === false ? "inactive" : "active";
      if (mode === "receive") defaults.date = todayISO();
      return defaults;
    },
  );
  const [picks, setPicks] = useOperatorState<Record<string, ERPRow | null>>(
    `GrowthForm:${entity}:${mode}:picks`,
    () => ({
      supplier_id: row?.supplier_id
        ? { id: row.supplier_id, label: row.supplier }
        : null,
      unit_id: row?.unit_id ? { id: row.unit_id, label: row.unit } : null,
      owner_id: {
        id: row?.owner_id || user?.id || "",
        label: row?.owner || user?.nama_lengkap,
      },
      assigned_to: { id: user?.id || "", label: user?.nama_lengkap },
      product_id: row?.product_id
        ? { id: row.product_id, label: row.product }
        : null,
      opportunity_id: row?.opportunity_id
        ? { id: row.opportunity_id, label: row.company }
        : null,
    }),
  );
  const [purchaseLines, setPurchaseLines] = useOperatorState<
    { key: string; material: ERPRow | null; quantity: string; price: string }[]
  >(
    `GrowthForm:${entity}:${mode}:purchaseLines`,
    () =>
      row?.lines?.map((l) => ({
        key: l.id,
        material: {
          id: l.material_id,
          label: l.code + " · " + l.name,
          unit: l.unit,
        },
        quantity: l.quantity,
        price: l.price,
      })) || [
        { key: crypto.randomUUID(), material: null, quantity: "", price: "" },
      ],
  );
  const [receiptLines, setReceiptLines] = useOperatorState(
    `GrowthForm:${entity}:${mode}:receiptLines`,
    () =>
      row?.lines
        ?.filter((l) => l.outstanding !== "0.000000")
        .map((l) => ({
          line_id: l.id,
          quantity: "",
          lot_number: "",
          expiry_date: "",
        })) || [],
  );
  const isReceipt = mode === "receive",
    isStage = mode === "stage",
    isConvert = mode === "convert";
  const fields: Field[] = isReceipt
    ? [
        { key: "date", label: "Receipt date", type: "date" },
        {
          key: "location_id",
          label: "Receive into",
          type: "picker",
          entity: "locations",
        },
        {
          key: "reason",
          label: "Delivery reference / notes",
          type: "textarea",
          optional: true,
        },
      ]
    : isStage
      ? [
          {
            key: "stage",
            label: "Stage",
            type: "select",
            options: states.opportunities,
          },
          { key: "reason", label: "Reason", type: "textarea" },
        ]
      : isConvert
        ? [
            {
              key: "customer_id",
              label: "Existing customer (optional)",
              type: "picker",
              entity: "customers",
              optional: true,
            },
          ]
        : configs[entity];
  const input: Record<string, unknown> = {};
  for (const field of fields)
    input[field.key] =
      field.type === "picker"
        ? picks[field.key]?.id || ""
        : value[field.key] || "";
  if (row?.id && !isReceipt && !isStage && !isConvert) {
    input.id = row.id;
    input.version = row.version;
  }
  if (entity === "suppliers" || entity === "materials")
    input.active = value.active === "active";
  if (entity === "opportunities" && !mode)
    input.probability = Number(value.probability);
  let action = actions[entity];
  if (entity === "purchases" && !mode)
    input.lines = purchaseLines.map((l) => ({
      material_id: l.material?.id,
      quantity: l.quantity,
      price: l.price,
    }));
  if (isReceipt) {
    action = "receive_purchase";
    Object.assign(input, {
      id: row?.id,
      version: row?.version,
      request_key: requestKey,
      hold: holdReceipt,
      lines: receiptLines.filter((l) => l.quantity.trim() !== ""),
    });
  }
  if (isStage) {
    action = "stage_opportunity";
    Object.assign(input, { id: row?.id, version: row?.version });
  }
  if (isConvert) {
    action = "convert_opportunity";
    Object.assign(input, { id: row?.id, version: row?.version });
  }
  if (entity === "material_stock") {
    Object.assign(input, {
      request_key: requestKey,
      lot_id: picks.stock?.lot_id,
      location_id: picks.stock?.location_id,
    });
    delete input.stock;
  }
  const update = (key: string, v: string) =>
    setValue((s) => ({
      ...s,
      [key]: key === "currency" ? v.toUpperCase() : v,
    }));
  return (
    <ERPForm
      action={action}
      payload={input}
      onDone={onDone}
      label={
        isReceipt
          ? "Post receipt"
          : isStage
            ? "Update stage"
            : isConvert
              ? "Link customer"
              : entity === "material_stock"
                ? "Post material issue"
                : entity === "suppliers"
                  ? "Save supplier"
                  : entity === "materials"
                    ? "Save material"
                    : entity === "opportunities"
                      ? "Save opportunity"
                      : entity === "crm_activities"
                        ? "Schedule activity"
                        : "Save draft"
      }
    >
      {isConvert && (
        <p className="erp-notice">
          Choose an existing customer to avoid duplicates. Leave empty to create
          one from this opportunity’s company and contact details.
        </p>
      )}
      {entity === "product_documents" && (
        <p className="erp-notice">
          Use a shareable HTTPS link to the original file. Access permissions
          stay with your document provider. Revision numbers are assigned
          automatically.
        </p>
      )}
      <div className="erp-form-grid">
        {fields.map((f) => (
          <ERPField
            key={f.key}
            name={f.key}
            label={f.label}
            hint={f.optional ? "Optional" : undefined}
          >
            {f.type === "picker" ? (
              <Selector
                field={f}
                value={picks[f.key] || null}
                onChange={(r) => setPicks((p) => ({ ...p, [f.key]: r }))}
              />
            ) : f.type === "select" ? (
              <select
                value={value[f.key] || f.options?.[0]}
                onChange={(e) => update(f.key, e.target.value)}
              >
                {f.options?.map((o) => (
                  <option key={o} value={o}>
                    {label(o)}
                  </option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea
                required={!f.optional}
                maxLength={1000}
                value={value[f.key] || ""}
                onChange={(e) => update(f.key, e.target.value)}
              />
            ) : (
              <Input
                required={!f.optional}
                type={f.type === "number" ? "text" : f.type || "text"}
                inputMode={f.type === "number" ? "decimal" : undefined}
                prefix={
                  /expected_value|price|amount/.test(f.key)
                    ? value.currency || "IDR"
                    : undefined
                }
                suffix={
                  f.key === "probability"
                    ? "%"
                    : f.key === "quantity"
                      ? picks.material_id?.unit || "Select material"
                      : undefined
                }
                maxLength={f.type === "url" ? 2000 : 150}
                value={value[f.key] || ""}
                onChange={(e) => update(f.key, e.target.value)}
              />
            )}
          </ERPField>
        ))}
      </div>
      {entity === "purchases" && !mode && (
        <div className="growth-edit-lines">
          {purchaseLines.map((l, i) => (
            <div className="growth-edit-line" key={l.key}>
              <div className="growth-line-title">
                <strong>Material {i + 1}</strong>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={purchaseLines.length === 1}
                  onClick={() =>
                    setPurchaseLines((v) => v.filter((_, n) => n !== i))
                  }
                >
                  Remove
                </Button>
              </div>
              <ERPPicker
                entity="materials"
                label="Material"
                name={`lines.${i}.material_id`}
                value={l.material}
                onChange={(m) =>
                  setPurchaseLines((v) =>
                    v.map((x, n) => (n === i ? { ...x, material: m } : x)),
                  )
                }
              />
              <div className="erp-form-grid">
                <ERPField
                  name={`lines.${i}.quantity`}
                  label={`Quantity (${l.material?.unit || "base unit"})`}
                >
                  <Input
                    required
                    inputMode="decimal"
                    suffix={l.material?.unit || "Select material"}
                    value={l.quantity}
                    onChange={(e) =>
                      setPurchaseLines((v) =>
                        v.map((x, n) =>
                          n === i ? { ...x, quantity: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </ERPField>
                <ERPField name={`lines.${i}.price`} label="Unit price">
                  <Input
                    required
                    inputMode="decimal"
                    prefix={value.currency || "IDR"}
                    value={l.price}
                    onChange={(e) =>
                      setPurchaseLines((v) =>
                        v.map((x, n) =>
                          n === i ? { ...x, price: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </ERPField>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={purchaseLines.length >= 100}
            onClick={() =>
              setPurchaseLines((v) => [
                ...v,
                {
                  key: crypto.randomUUID(),
                  material: null,
                  quantity: "",
                  price: "",
                },
              ])
            }
          >
            <Plus />
            Add material
          </Button>
          <p className="erp-notice">
            <strong>
              Estimated total:{" "}
              {money(
                decimalUnits(
                  purchaseLines.reduce(
                    (sum, l) =>
                      sum +
                      (units(l.quantity) * units(l.price) + BigInt(500000)) /
                        BigInt(1000000),
                    BigInt(0),
                  ),
                ),
                value.currency,
              )}
            </strong>
          </p>
          <p className="erp-notice">
            This draft does not change stock. Confirmation requires approval
            access. Prices are recorded in the selected currency; invoices and
            payment are managed in Finance when enabled.
          </p>
        </div>
      )}
      {isReceipt && (
        <div className="growth-edit-lines">
          <p className="erp-notice">
            Enter only the quantities received now. Leave a quantity blank to
            skip that line. Posting updates the purchase order and material
            stock together.
          </p>
          {erp.can("service", "write") && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={holdReceipt}
                onChange={(e) => setHoldReceipt(e.target.checked)}
              />
              Hold received lots for review
            </label>
          )}
          {receiptLines.map((l, i) => {
            const source = row?.lines?.find((s) => s.id === l.line_id);
            function change(k: string, v: string) {
              setReceiptLines((lines) =>
                lines.map((x, n) => (n === i ? { ...x, [k]: v } : x)),
              );
            }
            return (
              <div className="growth-edit-line" key={l.line_id}>
                <strong>
                  {source?.code} · {source?.name}
                </strong>
                <p className="text-xs text-muted">
                  Outstanding: {decimal(source?.outstanding)} {source?.unit}
                </p>
                <div className="erp-form-grid">
                  <ERPField
                    name={`lines.${receiptLines.filter((x) => x.quantity.trim() !== "").findIndex((x) => x.line_id === l.line_id)}.quantity`}
                    label="Receive quantity"
                  >
                    <button
                      type="button"
                      className="text-xs text-primary underline text-left"
                      onClick={() =>
                        change("quantity", String(source?.outstanding || "0"))
                      }
                    >
                      Use remaining {decimal(source?.outstanding)}{" "}
                      {source?.unit}
                    </button>
                    <Input
                      inputMode="decimal"
                      suffix={source?.unit || "Select unit"}
                      value={l.quantity}
                      onChange={(e) => change("quantity", e.target.value)}
                    />
                  </ERPField>
                  <ERPField
                    name={`lines.${receiptLines.filter((x) => x.quantity.trim() !== "").findIndex((x) => x.line_id === l.line_id)}.lot_number`}
                    label="Supplier lot number"
                  >
                    <Input
                      required={!!l.quantity}
                      maxLength={150}
                      value={l.lot_number}
                      onChange={(e) => change("lot_number", e.target.value)}
                    />
                  </ERPField>
                  <ERPField label="Expiry date" hint="Optional">
                    <Input
                      type="date"
                      value={l.expiry_date}
                      onChange={(e) => change("expiry_date", e.target.value)}
                    />
                  </ERPField>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ERPForm>
  );
}
