"use client";
import {
  humanLabel,
  displayNumber,
  fieldHelp,
  money,
  requestSuggestion,
  allocationSuggestion,
} from "@/lib/erp/ux";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ERPField, ERPForm } from "../shared";
import { ERPPicker } from "../picker";
import { useERPPage } from "../data";
import { useERP } from "../context";
import { shiftDate } from "@/lib/dashboard-analytics";
import { businessDate } from "@/lib/domain/validation";
import type { ERPAction, ERPRow } from "@/lib/erp/schema";
export type WorkflowRow = Omit<ERPRow, "lines"> & Record<string, unknown>;
export const value = (
  row: Record<string, unknown> | undefined,
  key: string,
  fallback = "",
) => (row?.[key] == null ? fallback : String(row[key]));
export const object = (row: Record<string, unknown> | undefined, key: string) =>
  (row?.[key] || {}) as Record<string, unknown>;
export const rows = (row: Record<string, unknown> | undefined, key: string) =>
  (row?.[key] || []) as Record<string, unknown>[];
const caseSources: Record<string, string[]> = {
  customer_claim: ["delivery", "order"],
  delivery_incident: ["delivery"],
  supplier_claim: ["receipt", "purchase"],
  receiving_exception: ["receipt"],
  supplier_return: ["receipt"],
  quality_retest: ["lot"],
  recall: ["lot", "product"],
  document_issue: ["document"],
  change_request: ["order", "purchase"],
};
const sourceEntities: Record<string, string> = {
  delivery: "posted_deliveries",
  receipt: "ops_material_receipts",
  lot: "lots",
  product: "catalog",
  order: "orders",
  purchase: "purchases",
  document: "product_documents",
};
export function WorkflowForm({
  action,
  row,
  onDone,
}: {
  action: ERPAction;
  row?: WorkflowRow;
  onDone: () => void;
}) {
  const erp = useERP(),
    terms = object(row, "terms");
  const [purpose, setPurpose] = useState("auto");
  const [amountEdited, setAmountEdited] = useState(false);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState<Record<string, unknown>>(() => ({
    id: row?.id,
    version: row?.version,
    request_key: requestKey,
    reason: "",
    notes: "",
    date: businessDate(),
    due_date: action === "fin_create_document" ? "" : businessDate(),
    kind:
      action === "fin_record_payment"
        ? "receipt"
        : action === "fin_create_document"
          ? value(row, "_kind", "invoice")
          : action === "fin_collection"
            ? "follow_up"
            : "customer_claim",
    source_type: "delivery",
    title: "",
    description: "",
    evidence: action === "ops_create_case" ? [] : "",
    quantity: "",
    state:
      (
        {
          open: "under_review",
          under_review: "awaiting_approval",
          awaiting_approval: "approved",
          approved: "in_progress",
          in_progress: "resolved",
          resolved: "closed",
          rejected: "closed",
        } as Record<string, string>
      )[value(row, "state")] || "under_review",
    resolution: "no_action",
    cost_payer: "company",
    currency: value(row, "currency", "IDR"),
    settlement_amount: "0",
    estimated_cost: "0",
    actual_cost: "0",
    mode: value(terms, "mode", "prepaid"),
    deposit_percent: value(terms, "deposit_percent", "0"),
    due_days: Number(terms.due_days ?? 30),
    billing_event: value(terms, "billing_event", "dispatch"),
    order_id:
      action === "fin_terms" || action === "fin_dispatch_override"
        ? row?.id
        : undefined,
    ...(action === "fin_terms" ? { version: terms.version } : {}),
    amount:
      action === "fin_allocate"
        ? ""
        : value(row, "outstanding", value(row, "available", "")),
    external_reference: "",
    lines: [],
    direction:
      value(row, "kind") === "credit_note"
        ? "refund"
        : value(row, "kind") === "supplier_credit"
          ? "supplier_refund"
          : value(row, "party_type") === "supplier"
            ? "payment"
            : "receipt",
    party_type: value(row, "party_type", "customer"),
    bank_account: "",
    bank_reference: "",
    document_id:
      action === "fin_allocate" || action === "fin_collection"
        ? row?.id
        : undefined,
    payment_id: undefined,
    credit_id: action === "fin_apply_credit" ? row?.id : undefined,
    customer_id: row?.customer_id,
    credit_limit: value(row, "credit_limit", "0"),
    on_hold: Boolean(row?.on_hold),
    hold_overdue: row?.hold_overdue !== false,
    promised_date: "",
    promised_amount: "",
    expires_on: businessDate(),
    recipient: "",
    received_date: businessDate(),
    status: "received",
    hold: true,
    assigned_to: "",
    locked_through: value(row, "locked_through"),
    backdate_days: Number(row?.backdate_days ?? 30),
    dual_approval: Boolean(row?.dual_approval),
  }));
  const [source, setSource] = useState<ERPRow | null>(
      (row?._source as ERPRow) || null,
    ),
    [related, setRelated] = useState<ERPRow | null>(null),
    [party, setParty] = useState<ERPRow | null>(
      (row?._party as ERPRow) || null,
    ),
    [payment, setPayment] = useState<ERPRow | null>(
      (row?._payment as ERPRow) || null,
    ),
    [lot, setLot] = useState<ERPRow | null>(null),
    [location, setLocation] = useState<ERPRow | null>(null),
    [owner, setOwner] = useState<ERPRow | null>(null),
    [delivery, setDelivery] = useState<ERPRow | null>(null),
    [certificate, setCertificate] = useState<ERPRow | null>(null),
    [claim, setClaim] = useState<ERPRow | null>(null);
  const set = (key: string, val: unknown) => {
    if (key === "amount") setAmountEdited(false);
    setForm((f) => ({ ...f, [key]: val }));
  };
  const sourceEntity =
    action === "fin_create_document"
      ? String(form.kind).startsWith("supplier")
        ? "fin_purchases"
        : "fin_orders"
      : action === "ops_delivery_receipt"
        ? "posted_deliveries"
        : sourceEntities[String(form.source_type)] || "catalog";
  const amendment =
    action === "ops_amend_order" || action === "ops_amend_purchase";
  const details = useERPPage(
    amendment
      ? action === "ops_amend_order"
        ? "orders"
        : "purchases"
      : action === "fin_create_document"
        ? sourceEntity
        : form.source_type === "delivery" || action === "ops_delivery_receipt"
          ? "movements"
          : sourceEntity,
    "",
    "",
    1,
    amendment ? value(row, "source_id") : source?.id,
    amendment ||
      (Boolean(source) &&
        [
          "fin_create_document",
          "ops_create_case",
          "ops_delivery_receipt",
        ].includes(action)),
  );
  const detail = details.data.rows[0] as WorkflowRow | undefined;
  const billing = object(
    detail || (source as WorkflowRow | undefined),
    "billing",
  );
  const sourceTerms = object(
    detail || (source as WorkflowRow | undefined),
    "terms",
  );
  const billingEvent = value(sourceTerms, "billing_event", "dispatch");
  const needsDelivery =
    action === "fin_create_document" &&
    form.kind === "invoice" &&
    billingEvent !== "order";
  const lineRows = needsDelivery
    ? rows(delivery as WorkflowRow | undefined, "billing_lines")
    : rows(detail, "lines");
  const suggestedRequest = requestSuggestion(
    value(detail || (source as WorkflowRow | undefined), "amount", "0"),
    value(sourceTerms, "deposit_percent", "0"),
    value(billing, "requested", "0"),
    purpose === "auto"
      ? Number(sourceTerms.deposit_percent) > 0
        ? "deposit"
        : "balance"
      : purpose,
  );
  const allocationDocument =
    row?.id && !row?._payment ? row : (related as WorkflowRow | undefined);
  const suggestedAllocation = allocationSuggestion(
    value(payment as WorkflowRow | undefined, "available", "0"),
    value(allocationDocument, "outstanding", "0"),
  );
  const effectiveAmount =
    form.amount === "" && !amountEdited
      ? action === "fin_allocate"
        ? suggestedAllocation
        : action === "fin_create_document" &&
            form.kind === "payment_request" &&
            purpose !== "custom"
          ? billing.requested != null
            ? suggestedRequest
            : ""
          : ""
      : String(form.amount);
  const allocationScope: Record<string, unknown> = {
    state: "verified",
    positive: true,
  };
  if (allocationDocument?.party_id)
    allocationScope.party_id = allocationDocument.party_id;
  if (allocationDocument?.party_type)
    allocationScope.party_type = allocationDocument.party_type;
  if (allocationDocument?.currency)
    allocationScope.currency = allocationDocument.currency;
  if (allocationDocument?.kind)
    allocationScope.direction = ["supplier_bill", "supplier_request"].includes(
      String(allocationDocument.kind),
    )
      ? "payment"
      : ["credit_note"].includes(String(allocationDocument.kind))
        ? "refund"
        : allocationDocument.kind === "supplier_credit"
          ? "supplier_refund"
          : "receipt";
  const fieldCurrency = String(
    action === "fin_create_document"
      ? related?.currency ||
          source?.currency ||
          row?.currency ||
          form.currency ||
          "IDR"
      : form.currency || row?.currency || source?.currency || "IDR",
  );
  const field = (
    key: string,
    label: string,
    type = "text",
    required = false,
    hint?: string,
  ) => (
    <ERPField key={key} name={key} label={label} hint={hint}>
      <Input
        type={type}
        prefix={
          /amount|cost|credit_limit|^price$/.test(key)
            ? fieldCurrency
            : undefined
        }
        suffix={
          key.endsWith("percent")
            ? "%"
            : /days$/.test(key)
              ? "days"
              : key === "quantity"
                ? String(
                    lot?.unit || source?.unit || row?.unit || "Select unit",
                  )
                : undefined
        }
        required={required}
        value={
          key === "amount"
            ? effectiveAmount
            : key === "due_date" && action === "fin_create_document"
              ? String(
                  form.due_date ||
                    shiftDate(
                      String(form.date),
                      Number(sourceTerms.due_days || 0),
                    ),
                )
              : String(form[key] ?? "")
        }
        onChange={(e) => {
          set(key, type === "number" ? Number(e.target.value) : e.target.value);
          if (key === "amount") setAmountEdited(true);
        }}
        inputMode={
          [
            "amount",
            "quantity",
            "price",
            "credit_limit",
            "deposit_percent",
            "settlement_amount",
            "estimated_cost",
            "actual_cost",
            "promised_amount",
          ].includes(key)
            ? "decimal"
            : undefined
        }
      />
    </ERPField>
  );
  const select = (key: string, label: string, options: string[]) => (
    <ERPField key={key} name={key} label={label}>
      <select
        aria-label={label}
        value={String(form[key] ?? "")}
        onChange={(e) => {
          set(key, e.target.value);
          if (key === "party_type") {
            setParty(null);
            set(
              "direction",
              e.target.value === "customer" ? "receipt" : "payment",
            );
          }
          if (key === "kind" || key === "source_type") {
            const sameSource =
              action === "fin_create_document" &&
              key === "kind" &&
              ((["invoice", "payment_request"].includes(String(form.kind)) &&
                ["invoice", "payment_request"].includes(e.target.value)) ||
                (["supplier_bill", "supplier_request"].includes(
                  String(form.kind),
                ) &&
                  ["supplier_bill", "supplier_request"].includes(
                    e.target.value,
                  )));
            if (!sameSource) setSource(null);
            setDelivery(null);
            setRelated(null);
            set("amount", "");
            set("lines", []);
            if (key === "kind" && action === "ops_create_case")
              set("source_type", caseSources[e.target.value][0]);
          }
        }}
      >
        {options.map((x) => (
          <option value={x} key={x}>
            {key === "direction"
              ? (
                  {
                    receipt: "Customer payment received",
                    payment: "Supplier payment sent",
                    refund: "Customer refund sent",
                    supplier_refund: "Supplier refund received",
                  } as Record<string, string>
                )[x] || humanLabel(x)
              : key === "billing_event" ||
                  key === "mode" ||
                  [
                    "payment_request",
                    "supplier_request",
                    "invoice",
                    "supplier_bill",
                    "credit_note",
                    "supplier_credit",
                  ].includes(x)
                ? humanLabel(x)
                : key === "source_type"
                  ? (
                      {
                        receipt: "Material receipt",
                        order: "Sales order",
                        purchase: "Purchase order",
                        delivery: "Delivery",
                        lot: "Product lot",
                        product: "Product",
                        document: "Product document",
                      } as Record<string, string>
                    )[x] || x.replaceAll("_", " ")
                  : x.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </ERPField>
  );
  const checkbox = (key: string, label: string) => (
    <label className="flex items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={Boolean(form[key])}
        onChange={(e) => set(key, e.target.checked)}
      />
      {label}
    </label>
  );
  const sourcePicker = (
    <ERPPicker
      entity={sourceEntity}
      name={
        action === "fin_create_document"
          ? sourceEntity === "fin_purchases"
            ? "purchase_id"
            : "order_id"
          : action === "ops_delivery_receipt"
            ? "delivery_id"
            : "source_id"
      }
      label={
        action === "fin_create_document" ? "Source order" : "Source record"
      }
      value={source}
      onChange={(r) => {
        setSource(r);
        setDelivery(null);
        set("amount", "");
        set("lines", []);
        if (action === "fin_create_document") {
          const days = Number(object(r as WorkflowRow, "terms").due_days || 0);
          const date = new Date(String(form.date) + "T00:00:00Z");
          date.setUTCDate(date.getUTCDate() + days);
          set("due_date", date.toISOString().slice(0, 10));
        }
      }}
    />
  );
  const submittedLines = (form.lines as Record<string, unknown>[]).filter(
    (line) => {
      const quantity = String(line.quantity ?? "").trim();
      return quantity !== "" && Number(quantity.replace(",", ".")) !== 0;
    },
  );
  const mappedLines = lineRows.map((l, i) => {
    const submittedIndex = submittedLines.findIndex(
      (line) => line.line_id === l.id,
    );
    const path =
      action === "fin_create_document"
        ? submittedIndex >= 0
          ? `lines.${submittedIndex}`
          : `unselected.${i}`
        : `lines.${i}`;
    const current = (form.lines as Record<string, unknown>[])[i] || {};
    return (
      <article className="workflow-line" key={value(l, "id", String(i))}>
        <strong>
          {value(l, "product", value(l, "name", value(l, "lot")))}
        </strong>
        <small>
          Ordered {value(l, "quantity", value(l, "base_quantity"))} ·
          Delivered/received {value(l, "delivered", value(l, "received", "—"))}{" "}
          · Unbilled {value(l, "unbilled", "—")}
        </small>
        {action === "ops_delivery_receipt" ? (
          ["accepted", "rejected"].map((k) => (
            <ERPField
              name={`lines.${i}.${k}`}
              label={`${k === "accepted" ? "Accepted" : "Rejected"} quantity — line ${i + 1}`}
              key={k}
            >
              <Input
                inputMode="decimal"
                suffix={value(l, "base_unit", value(l, "unit", "Select unit"))}
                required
                value={String(
                  current[k] ?? (k === "accepted" ? l.base_quantity : "0"),
                )}
                onChange={(e) => {
                  const lines = lineRows.map((x, j) => ({
                    accepted: "0",
                    rejected: "0",
                    ...((form.lines as object[])[j] || {}),
                    order_line_id: x.order_line_id,
                    lot_id: x.lot_id,
                  }));
                  lines[i] = { ...lines[i], [k]: e.target.value };
                  set("lines", lines);
                }}
              />
            </ERPField>
          ))
        ) : (
          <>
            <ERPField
              name={`${path}.quantity`}
              label={`${amendment ? "Revised" : "Invoice"} quantity — line ${i + 1}`}
            >
              {!amendment && (
                <button
                  type="button"
                  className="text-xs text-primary underline text-left"
                  onClick={() => {
                    const lines = lineRows.map((x, j) => ({
                      line_id: x.id,
                      quantity: "0",
                      price: x.price,
                      ...((form.lines as object[])[j] || {}),
                    }));
                    lines[i] = {
                      ...lines[i],
                      quantity: value(l, "unbilled", "0"),
                    };
                    set("lines", lines);
                  }}
                >
                  Use remaining {value(l, "unbilled", "0")}
                </button>
              )}
              <Input
                inputMode="decimal"
                suffix={value(l, "unit", value(l, "base_unit", "Select unit"))}
                value={String(
                  current.quantity ?? (amendment ? l.quantity : ""),
                )}
                onChange={(e) => {
                  const lines = lineRows.map((x, j) => ({
                    line_id: x.id,
                    quantity: amendment ? String(x.quantity) : "0",
                    price: x.price,
                    ...((form.lines as object[])[j] || {}),
                  }));
                  lines[i] = { ...lines[i], quantity: e.target.value };
                  set("lines", lines);
                }}
              />
            </ERPField>
            {form.kind === "supplier_bill" && (
              <ERPField
                name={`${path}.price`}
                label={`Supplier unit price — line ${i + 1}`}
              >
                <Input
                  inputMode="decimal"
                  prefix={fieldCurrency}
                  value={String(current.price ?? l.price ?? "")}
                  onChange={(e) => {
                    const lines = lineRows.map((x, j) => ({
                      line_id: x.id,
                      quantity: "0",
                      price: x.price,
                      ...((form.lines as object[])[j] || {}),
                    }));
                    lines[i] = { ...lines[i], price: e.target.value };
                    set("lines", lines);
                  }}
                />
              </ERPField>
            )}
          </>
        )}
      </article>
    );
  });
  const payload: Record<string, unknown> = {
    ...form,
    amount: effectiveAmount,
    request_key: requestKey,
  };
  if (action === "ops_create_case") {
    payload.source_id = source?.id;
    payload.assigned_to = owner?.id;
    payload.lot_id = lot?.id;
  }
  if (amendment)
    payload.lines = lineRows.map((l, i) => ({
      line_id: l.id,
      quantity: String(
        (form.lines as Record<string, unknown>[])[i]?.quantity ?? l.quantity,
      ),
    }));
  if (action === "ops_customer_return") payload.location_id = location?.id;
  if (action === "ops_delivery_receipt") {
    payload.delivery_id = source?.id;
    payload.lines = lineRows.map((l, i) => ({
      order_line_id: l.order_line_id,
      lot_id: l.lot_id,
      accepted: String(l.base_quantity),
      rejected: "0",
      ...((form.lines as Record<string, unknown>[])[i] || {}),
    }));
  }
  if (action === "fin_create_document") {
    payload.order_id = String(form.kind).startsWith("supplier")
      ? undefined
      : source?.id;
    payload.purchase_id = String(form.kind).startsWith("supplier")
      ? source?.id
      : undefined;
    payload.related_id = ["credit_note", "supplier_credit"].includes(
      String(form.kind),
    )
      ? related?.id
      : undefined;
    if (["invoice", "supplier_bill"].includes(String(form.kind)))
      payload.amount = undefined;
    payload.due_date =
      form.due_date ||
      shiftDate(String(form.date), Number(sourceTerms.due_days || 0));
    payload.case_id = claim?.id;
    payload.delivery_id = delivery?.id;
    payload.lines = submittedLines.map((l) => ({
      ...l,
      ...(form.kind === "supplier_bill" && !l.price
        ? { price: lineRows.find((x) => x.id === l.line_id)?.price }
        : {}),
    }));
  }
  if (["ops_replacement", "ops_supplier_return"].includes(action)) {
    payload.lot_id = action === "ops_supplier_return" ? lot?.lot_id : lot?.id;
    payload.location_id = location?.id;
  }
  if (action === "ops_withdraw_coa") payload.coa_id = certificate?.id;
  if (action === "ops_assign_case") payload.assigned_to = owner?.id;
  if (action === "fin_record_payment") payload.party_id = party?.id;
  if (action === "fin_allocate") {
    payload.payment_id = payment?.id;
    payload.document_id = allocationDocument?.id;
  }
  if (action === "fin_move_allocation") payload.document_id = related?.id;
  if (action === "fin_apply_credit") payload.invoice_id = related?.id;
  if (action === "fin_credit_policy")
    payload.customer_id = party?.id || row?.customer_id;
  return (
    <ERPForm
      action={action}
      payload={payload}
      disabled={
        action === "fin_create_document" &&
        (details.loading ||
          (sourceEntity === "fin_orders" &&
            source !== null &&
            value(sourceTerms, "state") !== "approved") ||
          (needsDelivery && !delivery))
      }
      onDone={onDone}
      label={
        action === "fin_create_document"
          ? "Save billing draft"
          : action === "ops_create_case"
            ? "Create case"
            : "Save"
      }
    >
      {action === "ops_create_case" && (
        <>
          {select("kind", "Case type", Object.keys(caseSources))}
          {select("source_type", "Source type", caseSources[String(form.kind)])}
          {sourcePicker}
          {field("title", "Title", "text", true)}
          {field("description", "Description")}
          {field("quantity", "Claim quantity (base unit)")}
          <ERPPicker
            entity="lots"
            label="Original delivered lot (for quantity claims)"
            value={lot}
            onChange={setLot}
          />
          <ERPPicker
            entity="ops_owners"
            label="Assigned to (optional)"
            value={owner}
            onChange={setOwner}
          />
          {field("due_date", "Due date", "date")}
          <ERPField label="Evidence links (one HTTPS URL per line)">
            <textarea
              rows={3}
              value={(form.evidence as string[]).join("\n")}
              onChange={(e) =>
                set("evidence", e.target.value.split("\n").filter(Boolean))
              }
            />
          </ERPField>
        </>
      )}
      {action === "ops_case_transition" && (
        <>
          {select(
            "state",
            "Next status",
            row?.state === "open"
              ? ["under_review", "awaiting_approval"]
              : row?.state === "under_review"
                ? ["awaiting_approval"]
                : row?.state === "awaiting_approval"
                  ? ["approved", "rejected", "under_review"]
                  : row?.state === "approved"
                    ? ["in_progress"]
                    : row?.state === "in_progress"
                      ? ["resolved"]
                      : ["closed"],
          )}
          {select("resolution", "Resolution", [
            "no_action",
            "replacement",
            "return",
            "credit",
            "refund",
            "scrap",
            "correction",
          ])}
          {select("cost_payer", "Cost responsibility", [
            "company",
            "customer",
            "supplier",
            "carrier",
            "shared",
            "undecided",
          ])}
          {field("currency", "Currency")}
          {["refund", "credit"].includes(String(form.resolution)) &&
            field(
              "settlement_amount",
              "Approved settlement amount",
              "text",
              true,
            )}
          {field("estimated_cost", "Estimated cost")}
          {field("actual_cost", "Actual cost")}
        </>
      )}
      {action === "ops_assign_case" && (
        <>
          <ERPPicker
            entity="ops_owners"
            label="Assigned to"
            value={owner}
            onChange={setOwner}
          />
          {field("due_date", "Due date", "date")}
        </>
      )}
      {action === "ops_delivery_receipt" && (
        <>
          {sourcePicker}
          {field("recipient", "Recipient", "text", true)}
          {field("received_date", "Received date", "date", true)}
          {select("status", "Receipt status", [
            "received",
            "partial",
            "rejected",
            "returned",
          ])}
          {details.loading && source ? (
            <p role="status">Loading delivery lines…</p>
          ) : (
            mappedLines
          )}
          {field(
            "evidence",
            "Signed delivery note / evidence reference",
            "text",
            true,
          )}
          {field("notes", "Notes")}
        </>
      )}
      {[
        "ops_replacement",
        "ops_supplier_return",
        "ops_customer_return",
      ].includes(action) && (
        <>
          <p className="erp-notice">
            Execution uses base stock units, consumes the approved quantity and
            creates an immutable stock transaction.
          </p>
          {action !== "ops_customer_return" && (
            <ERPPicker
              entity={action === "ops_replacement" ? "lots" : "material_stock"}
              label="Execution lot"
              value={lot}
              onChange={setLot}
            />
          )}
          <ERPPicker
            entity="locations"
            label="Source location"
            value={location}
            onChange={setLocation}
          />
          {action !== "ops_customer_return" &&
            field("quantity", "Quantity", "text", true)}
        </>
      )}
      {action === "ops_material_hold" && (
        <>
          {checkbox("hold", "Hold this material lot")}
          {field("reason", "Reason", "text", true)}
        </>
      )}
      {action === "ops_withdraw_coa" && (
        <ERPPicker
          entity="ops_certificates"
          label="Certificate to withdraw"
          value={certificate}
          onChange={setCertificate}
        />
      )}
      {amendment && (
        <>
          <p className="erp-notice">
            Agreed prices remain unchanged. Existing dispatch reservations are
            released for re-planning. Quantities cannot fall below delivered or
            received stock.
          </p>
          {mappedLines}
          {action === "ops_amend_purchase" && (
            <>
              {field("expected_date", "Expected receipt date", "date", true)}
              {field("terms", "Updated commercial terms", "text", true)}
            </>
          )}
        </>
      )}
      {action === "ops_policy" && (
        <>
          {field("backdate_days", "Maximum backdate days", "number", true)}
          {field(
            "locked_through",
            "Lock transactions through (optional)",
            "date",
          )}
          {checkbox(
            "dual_approval",
            "Require a second approver for legacy operational approvals",
          )}
        </>
      )}
      {action === "fin_terms" && (
        <>
          <p className="erp-notice">
            Terms changes require Finance approval again. Dispatch is checked at
            posting time.
          </p>
          {select("mode", "Payment terms", [
            "prepaid",
            "deposit_before",
            "deposit_credit",
            "credit",
          ])}
          {field("deposit_percent", "Deposit percentage", "text", true)}
          {field("due_days", "Credit days", "number", true)}
          {select("billing_event", "When to issue the invoice", [
            "order",
            "dispatch",
            "receipt",
          ])}
        </>
      )}
      {action === "fin_dispatch_override" && (
        <>
          {field(
            "expires_on",
            "Exception expiry (maximum 7 days)",
            "date",
            true,
          )}
          <p className="erp-notice">
            An approved exception is auditable and does not mark the customer
            debt as paid.
          </p>
        </>
      )}
      {action === "fin_credit_policy" && (
        <>
          {!row?.customer_id && (
            <ERPPicker
              entity="fin_customers"
              label="Customer"
              value={party}
              onChange={setParty}
            />
          )}{" "}
          {field("currency", "Currency", "text", true)}
          {field("credit_limit", "Credit limit", "text", true)}
          {checkbox("on_hold", "Customer credit hold")}
          {checkbox("hold_overdue", "Hold dispatch when invoices are overdue")}
        </>
      )}
      {action === "fin_create_document" && (
        <>
          {select("kind", "Document type", [
            "invoice",
            "payment_request",
            "supplier_bill",
            "supplier_request",
            "credit_note",
            "supplier_credit",
          ])}
          {["credit_note", "supplier_credit"].includes(String(form.kind)) ? (
            <ERPPicker
              entity="fin_documents"
              label="Original issued invoice/bill"
              name="related_id"
              value={related}
              onChange={setRelated}
            />
          ) : (
            sourcePicker
          )}
          {source && (
            <section className="erp-notice" aria-label="Source billing summary">
              <strong>
                {value(
                  source as WorkflowRow,
                  "label",
                  value(source as WorkflowRow, "number"),
                )}
              </strong>
              <p>
                Order total:{" "}
                {money(
                  value(detail || (source as WorkflowRow), "amount", "0"),
                  value(detail || (source as WorkflowRow), "currency", "IDR"),
                )}
              </p>
              {sourceEntity === "fin_orders" && (
                <>
                  <p>
                    Terms:{" "}
                    {humanLabel(value(sourceTerms, "mode", "Not configured"))} ·{" "}
                    {value(sourceTerms, "state", "Not configured")}
                  </p>
                  <p>
                    Deposit:{" "}
                    {displayNumber(value(sourceTerms, "deposit_percent", "0"))}%
                    · Requested:{" "}
                    {money(
                      value(billing, "requested", "0"),
                      value(source as WorkflowRow, "currency", "IDR"),
                    )}{" "}
                    · Verified allocated:{" "}
                    {money(
                      value(billing, "paid", "0"),
                      value(source as WorkflowRow, "currency", "IDR"),
                    )}
                  </p>
                  {value(sourceTerms, "state") !== "approved" && (
                    <p role="alert">
                      Approve payment terms in Finance → Sales orders before
                      saving billing.
                    </p>
                  )}
                  {form.kind === "invoice" && (
                    <p>
                      {humanLabel(billingEvent)}.{" "}
                      {needsDelivery
                        ? "Choose a posted delivery below. For payment before shipment, choose Payment request / advance."
                        : "An invoice can be created before shipment."}
                    </p>
                  )}
                  {!details.loading && billing.requested == null && (
                    <p role="status">
                      Automatic billing suggestions need a database update.
                      Review existing payment requests before entering a manual
                      amount.
                    </p>
                  )}
                  {rows(billing, "requests").map((r) => (
                    <p key={value(r, "id")}>
                      <a
                        className="underline"
                        href={
                          "/dashboard/finance?view=documents&record=" +
                          value(r, "id")
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {value(r, "number")}
                      </a>{" "}
                      · {humanLabel(value(r, "state"))} · Remaining{" "}
                      {money(
                        value(r, "outstanding", "0"),
                        value(source as WorkflowRow, "currency", "IDR"),
                      )}
                    </p>
                  ))}
                </>
              )}
            </section>
          )}
          {form.kind === "payment_request" && source && (
            <ERPField
              label="Payment request purpose"
              help="Suggestions subtract existing non-void payment requests to avoid requesting the same advance twice. Unpaid requests remain payable; use the existing request for a partial payment."
            >
              <select
                value={purpose}
                onChange={(e) => {
                  setPurpose(e.target.value);
                  set("amount", "");
                }}
              >
                <option value="auto">Follow approved payment terms</option>
                <option value="deposit">Down payment (DP)</option>
                <option value="balance">Remaining order balance</option>
                <option value="custom">Custom amount</option>
              </select>
            </ERPField>
          )}
          {field("date", "Document date", "date", true)}
          {field("due_date", "Due date", "date", true)}
          {[
            "payment_request",
            "supplier_request",
            "credit_note",
            "supplier_credit",
          ].includes(String(form.kind)) ? (
            field("amount", "Amount", "text", true)
          ) : (
            <>
              {needsDelivery && source && (
                <ERPPicker
                  entity="posted_deliveries"
                  label="Posted delivery"
                  name="delivery_id"
                  scope={{ order_id: source?.id }}
                  value={delivery}
                  onChange={(r) => {
                    setDelivery(r);
                    set("lines", []);
                  }}
                />
              )}
              {lineRows.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-primary underline text-left"
                  onClick={() =>
                    set(
                      "lines",
                      lineRows.map((l) => ({
                        line_id: l.id,
                        quantity: value(l, "unbilled", "0"),
                        price: l.price,
                      })),
                    )
                  }
                >
                  Use all remaining quantities
                </button>
              )}
              {details.loading && source ? (
                <p role="status">Loading billing lines…</p>
              ) : (
                mappedLines
              )}
              <p className="erp-notice">
                Enter only quantities being billed. Prices, tax and freight for
                sales invoices come from the agreed SO. Supplier price
                differences require explicit approval.
              </p>
            </>
          )}
          {form.kind === "supplier_bill" &&
            field(
              "external_reference",
              "Supplier invoice number",
              "text",
              true,
            )}
          {erp.can("service") && (
            <ERPPicker
              entity="ops_cases"
              label="Approved financial claim (optional)"
              value={claim}
              onChange={setClaim}
            />
          )}{" "}
          {field("notes", "Notes / commercial terms")}
          {field("reason", "Correction reason (for credits)")}
        </>
      )}
      {action === "fin_record_payment" && (
        <>
          {select("party_type", "Party type", ["customer", "supplier"])}
          {select(
            "direction",
            "Payment direction",
            form.party_type === "customer"
              ? ["receipt", "refund"]
              : ["payment", "supplier_refund"],
          )}
          <ERPPicker
            entity={
              form.party_type === "customer" ? "fin_customers" : "fin_suppliers"
            }
            label="Counterparty"
            value={party}
            onChange={setParty}
          />
          {field("currency", "Currency", "text", true)}
          {field("amount", "Payment amount", "text", true)}
          {field("date", "Payment date", "date", true)}
          {field("bank_account", "Bank / cash account reference", "text", true)}
          {field("bank_reference", "Bank transaction reference", "text", true)}
          {field(
            "evidence",
            "Verified funds / bank evidence reference",
            "text",
            true,
          )}
          {field("notes", "Notes")}
          <p className="erp-notice">
            Recording a payment does not verify it or execute a bank transfer.
            An authorized approver must verify actual funds.
          </p>
        </>
      )}
      {action === "fin_allocate" && (
        <>
          <ERPPicker
            entity="fin_payments"
            label="Verified payment"
            name="payment_id"
            scope={allocationScope}
            value={payment}
            onChange={(r) => {
              setPayment(r);
              set("amount", "");
            }}
          />
          {(!row?.id || Boolean(row?._payment)) && (
            <ERPPicker
              entity="fin_documents"
              label="Issued document"
              scope={{
                state: "issued",
                positive: true,
                ...((payment as WorkflowRow)?.party_id
                  ? { party_id: (payment as WorkflowRow).party_id }
                  : {}),
                ...(payment?.currency ? { currency: payment.currency } : {}),
              }}
              value={related}
              onChange={(r) => {
                setRelated(r);
                if (!row?._payment) setPayment(null);
                set("amount", "");
              }}
            />
          )}{" "}
          {field("amount", "Allocation amount", "text", true)}
          <p className="erp-notice">{fieldHelp.allocation}</p>
          {payment && allocationDocument && (
            <p className="erp-notice">
              Suggested allocation:{" "}
              <strong>
                {money(
                  suggestedAllocation,
                  value(payment as WorkflowRow, "currency", "IDR"),
                )}
              </strong>
              . This is limited to the available payment and document balance.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => set("amount", "")}
              >
                Use suggested amount
              </button>
            </p>
          )}
        </>
      )}
      {action === "fin_move_allocation" && (
        <>
          <ERPPicker
            entity="fin_documents"
            label="Destination issued invoice"
            value={related}
            onChange={setRelated}
          />
          {field("amount", "Amount to move", "text", true)}
          <p className="erp-notice">
            Move all or part of a paid advance to the final invoice. The
            remaining amount stays linked to the original document.
          </p>
        </>
      )}
      {action === "fin_apply_credit" && (
        <>
          <ERPPicker
            entity="fin_documents"
            label="Issued invoice/bill to reduce"
            value={related}
            onChange={setRelated}
          />
          {field("amount", "Credit amount", "text", true)}
        </>
      )}
      {action === "fin_collection" && (
        <>
          {select("kind", "Follow-up type", [
            "follow_up",
            "promise",
            "dispute",
            "resolve_dispute",
          ])}
          {field("promised_date", "Promised payment date", "date")}
          {field("promised_amount", "Promised amount")}
        </>
      )}
      {![
        "ops_create_case",
        "ops_delivery_receipt",
        "ops_material_hold",
        "fin_terms",
        "fin_create_document",
        "fin_record_payment",
        "ops_policy",
      ].includes(action) &&
        field("reason", "Reason / completion evidence", "text", true)}
      {action === "fin_credit_policy" && null}
    </ERPForm>
  );
}
