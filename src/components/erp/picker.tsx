"use client";
import { useState, useId } from "react";
import {
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
} from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ERPField, useERPFieldError } from "./shared";
import { humanLabel, money, displayNumber } from "@/lib/erp/ux";
import { useERPPage } from "./data";
import type { ERPRow } from "@/lib/erp/schema";
type PickerProps = {
  entity: string;
  label: string;
  value: ERPRow | null;
  onChange: (row: ERPRow) => void;
  filterProduct?: string;
  hideLabel?: boolean;
  scope?: Record<string, unknown>;
  name?: string;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};
export function ERPPicker(props: PickerProps) {
  return (
    <Picker
      key={JSON.stringify([props.entity, props.filterProduct, props.scope])}
      {...props}
    />
  );
}
function choiceSummary(row: ERPRow) {
  const r = row as unknown as Record<string, unknown>;
  return [
    r.customer || r.name || r.party,
    r.product,
    r.lot_number,
    r.location,
    r.expiry_date ? "Expires " + String(r.expiry_date) : "",
    r.date,
    r.state ? humanLabel(String(r.state)) : "",
    r.amount && r.currency ? money(String(r.amount), String(r.currency)) : "",
    r.available != null
      ? "Available " +
        (r.currency
          ? money(String(r.available), String(r.currency))
          : displayNumber(String(r.available)) +
            (r.unit ? " " + String(r.unit) : ""))
      : "",
    r.outstanding != null
      ? "Remaining " + money(String(r.outstanding), String(r.currency || "IDR"))
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
function Picker({
  entity,
  label,
  value,
  onChange,
  filterProduct,
  hideLabel = false,
  scope,
  name,
  id,
  ...accessibility
}: PickerProps) {
  const error = useERPFieldError(name, label);
  const generatedId = useId();
  const triggerId = id || generatedId;
  const [open, setOpen] = useState(false),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [preview, setPreview] = useState(false);
  const result = useERPPage(
    filterProduct ? "availability" : "choices/" + entity,
    q,
    "",
    page,
    filterProduct,
    open,
    scope,
  );
  const rows = filterProduct
    ? result.data.rows.filter((r) => r.product_id === filterProduct)
    : result.data.rows;
  const content = (
    <div className="erp-picker">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="erp-picker-trigger"
              id={triggerId}
              data-invalid={error ? true : accessibility["aria-invalid"]}
              aria-describedby={
                error ? triggerId + "-error" : accessibility["aria-describedby"]
              }
              aria-label={label}
            />
          }
        >
          {value?.label ||
            value?.name ||
            value?.number ||
            value?.product ||
            "Select…"}
          <ChevronDown className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent className="erp-picker-panel" align="start">
          <div className="erp-picker-search">
            <Search className="size-3.5" />
            <Input
              aria-label={"Search " + label}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search number, company, product…"
            />
          </div>
          <div className="erp-picker-results">
            {result.loading ? (
              <p role="status">Loading…</p>
            ) : result.error ? (
              <p role="alert">{result.error}</p>
            ) : rows.length === 0 ? (
              <p>
                No eligible {label.toLowerCase()} found. Check the source,
                status and remaining balance, or try another search.
              </p>
            ) : (
              rows.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    onChange(r);
                    setPreview(false);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {r.label || r.name || r.number || r.product}
                    </span>
                    <small className="block text-muted leading-relaxed">
                      {choiceSummary(r)}
                    </small>
                  </span>
                  {r.id === value?.id && <Check className="size-3.5" />}
                </button>
              ))
            )}
          </div>
          <div className="erp-picker-pages">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Previous options"
              disabled={page === 1 || result.loading}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft />
            </Button>
            <span>
              Page {page} · {result.data.total} options
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Next options"
              disabled={result.loading || page * 50 >= result.data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {value && (
        <div className="mt-1.5 space-y-1 text-xs text-muted">
          <p>{choiceSummary(value)}</p>
          <button
            type="button"
            className="text-primary underline"
            aria-expanded={preview}
            onClick={() => setPreview(!preview)}
          >
            {preview ? "Hide selection details" : "Review selection"}
          </button>
          {preview && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border p-3">
              {Object.entries(value)
                .filter(
                  ([k, v]) =>
                    [
                      "number",
                      "name",
                      "customer",
                      "supplier",
                      "party",
                      "product",
                      "lot_number",
                      "location",
                      "date",
                      "due_date",
                      "mfg_date",
                      "expiry_date",
                      "state",
                      "qc_status",
                      "kind",
                      "currency",
                      "amount",
                      "outstanding",
                      "available",
                      "quantity",
                      "unit",
                      "bank_reference",
                      "customer_reference",
                      "external_reference",
                    ].includes(k) &&
                    ["string", "number"].includes(typeof v) &&
                    v !== "",
                )
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt>{humanLabel(k)}</dt>
                    <dd className="break-words min-w-0">{String(v)}</dd>
                  </div>
                ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
  return hideLabel ? (
    content
  ) : (
    <ERPField controlId={triggerId} name={name} label={label}>
      {content}
    </ERPField>
  );
}
