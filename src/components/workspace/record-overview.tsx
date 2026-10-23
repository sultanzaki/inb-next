"use client";
import { useEffect, useRef } from "react";
import { Package, FileText, MapPin, ArrowUpRight } from "lucide-react";
import { humanLabel, displayNumber, money } from "@/lib/erp/ux";
import { Badge } from "@/components/ui/badge";

type Row = Record<string, unknown>;
function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}
function first(row: Row, keys: string[]) {
  return keys.map((k) => text(row[k])).find(Boolean) || "";
}
export function RecordOverview({ row, entity }: { row: Row; entity: string }) {
  const snapshot =
    row.snapshot && typeof row.snapshot === "object"
      ? (row.snapshot as Row)
      : {};
  const totals =
    row.totals && typeof row.totals === "object"
      ? (row.totals as Row)
      : snapshot.totals && typeof snapshot.totals === "object"
        ? (snapshot.totals as Row)
        : {};
  const currency = text(row.currency) || text(snapshot.currency);
  const title = first(row, ["number", "label", "name", "product", "code"]);
  const party = first(row, [
    "customer",
    "customer_name",
    "supplier",
    "supplier_name",
    "product",
    "warehouse",
  ]);
  const date = first(row, [
    "date",
    "order_date",
    "quotation_date",
    "created_at",
  ]);
  const amount =
    first(row, ["grand_total", "total_amount", "total", "amount"]) ||
    text(totals.total);
  const state = first(row, ["display_state", "state"]);
  return (
    <section className="record-overview" aria-label="Record overview">
      <div className="record-overview-mark">
        <FileText size={22} />
      </div>
      <div className="record-overview-heading">
        <span className="record-eyebrow">{humanLabel(entity)}</span>
        <h3>{title || "Record details"}</h3>
        {party && party !== title && <p>{party}</p>}
      </div>
      {state && <Badge variant="secondary">{humanLabel(state)}</Badge>}
      <dl className="record-overview-metrics">
        {date && (
          <div>
            <dt>Document date</dt>
            <dd>{date.slice(0, 10)}</dd>
          </div>
        )}
        {amount && currency ? (
          <div>
            <dt>Document value</dt>
            <dd>{money(amount, currency)}</dd>
          </div>
        ) : null}
        {Array.isArray(row.lines) && (
          <div>
            <dt>Line items</dt>
            <dd>{row.lines.length}</dd>
          </div>
        )}
        {text(row.location) && (
          <div>
            <dt>Location</dt>
            <dd>{text(row.location)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
export function ContextSummary({
  values: input,
  title = "Working summary",
}: {
  values: unknown;
  title?: string;
}) {
  const values = input && typeof input === "object" ? (input as Row) : {};
  const panel = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (panel.current)
      panel.current.open = window.matchMedia("(min-width: 1100px)").matches;
  }, []);
  const fields = [
    "date",
    "quotation_date",
    "valid_until",
    "due_date",
    "mfg_date",
    "release_date",
    "quantity",
    "qty",
    "currency",
    "tax_rate",
    "discount",
    "shipping",
    "amount",
    "reason",
  ];
  const entries = fields.filter((k) => text(values[k]) !== "");
  const lines = Object.entries(values).find(
    ([k, v]) => /lines$/.test(k) && Array.isArray(v),
  );
  if (!entries.length && !lines) return null;
  return (
    <details ref={panel} className="context-summary">
      <summary>
        <span>{title}</span>
        <span className="context-summary-hint">Live preview</span>
      </summary>
      <dl>
        {lines && (
          <div>
            <dt>Line items</dt>
            <dd>{(lines[1] as unknown[]).length}</dd>
          </div>
        )}
        {entries.slice(0, 6).map((k) => (
          <div key={k}>
            <dt>{humanLabel(k)}</dt>
            <dd>
              {[
                "quantity",
                "qty",
                "amount",
                "tax_rate",
                "discount",
                "shipping",
              ].includes(k) && Number.isFinite(Number(values[k]))
                ? displayNumber(String(values[k]))
                : text(values[k])}
              {k === "tax_rate" ? "%" : ""}
            </dd>
          </div>
        ))}
      </dl>
      <p>Review before saving. This preview does not post a transaction.</p>
    </details>
  );
}
export function WarehouseBoard({
  rows,
  entity,
  onSelect,
  total,
}: {
  rows: Row[];
  entity: string;
  onSelect: (id: string) => void;
  total: number;
}) {
  return (
    <section className="warehouse-board" aria-label="Warehouse visual overview">
      <header>
        <div>
          <span className="record-eyebrow">Warehouse overview</span>
          <h3>
            {entity === "pallets"
              ? "Every pallet, in place."
              : "Your storage network."}
          </h3>
        </div>
        <p>
          {rows.length} shown · {total} matching records
        </p>
      </header>
      <div className="warehouse-card-grid">
        {rows.map((row) => (
          <button
            type="button"
            className="warehouse-visual-card"
            key={String(row.id)}
            onClick={() => onSelect(String(row.id))}
          >
            <div className="warehouse-card-top">
              {entity === "pallets" ? (
                <Package size={23} />
              ) : (
                <MapPin size={23} />
              )}
              <Badge variant="secondary">
                {humanLabel(text(row.state) || "Record")}
              </Badge>
              <ArrowUpRight size={16} />
            </div>
            <strong>
              {first(row, ["number", "label", "name", "code"]) || "View record"}
            </strong>
            <span>
              {first(row, ["warehouse", "address"]) || "Open for details"}
            </span>
            <div className="warehouse-card-location">
              <MapPin size={14} />
              {first(row, ["location", "bin"]) ||
                (entity === "warehouses"
                  ? "Storage site"
                  : "Location not assigned")}
            </div>
          </button>
        ))}
      </div>
      {!rows.length && (
        <p className="warehouse-board-empty">
          No records match this view. Adjust your search or filters.
        </p>
      )}
    </section>
  );
}
