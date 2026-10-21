"use client";
import { useState } from "react";
import { useERPPage } from "./data";
import { useERP } from "./context";
import { ERPModal, ERPForm, ERPField, ERPActionButton } from "./shared";
import { Button } from "@/components/ui/button";
import { humanLabel, displayNumber, money } from "@/lib/erp/ux";
type Line = {
  id: string;
  product: string;
  unit: string;
  ordered: string;
  actual: string;
  closing: string;
  reserved?: string;
};
type Closure = {
  reason: string;
  approver: string;
  created_at: string;
  lines: Line[];
};
type Preview = {
  source_type: "order" | "purchase";
  source_id: string;
  number: string;
  version?: number;
  can_close: boolean;
  review_token: string;
  blockers: string[];
  lines: Line[];
  financial?: { actual_value: string; advance_requested: string };
};
type MatchLine = {
  id: string;
  product: string;
  unit: string;
  ordered: string;
  received: string;
  billed_elsewhere: string;
  bill_quantity: string;
  agreed_price: string;
  bill_price: string;
  price_variance: string;
  quantity_valid: boolean;
};
type Matching = {
  purchase_number: string;
  quantity_valid: boolean;
  has_variance: boolean;
  review_token: string;
  lines: MatchLine[];
};
type Event = {
  id: string;
  action: string;
  actor: string;
  reason: string;
  created_at: string;
  changes: {
    table: string;
    row_id: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }[];
};
type Control = {
  kind: string;
  closure_preview: Preview | null;
  closure: Closure | null;
  matching: Matching | null;
  variance_review: {
    current: boolean;
    reviewer: string;
    reason: string;
    created_at: string;
  } | null;
  history: Event[];
  amendments: {
    id: string;
    reason: string;
    actor: string;
    created_at: string;
  }[];
};
const stamp = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
const eventTitle = (action: string) =>
  humanLabel(action.replace(/^(erp_|fin_|ops_)/, ""));
function QuantityReview({ lines }: { lines: Line[] }) {
  return (
    <div className="control-lines">
      {lines.map((line) => (
        <article key={line.id}>
          <strong>{line.product}</strong>
          <p>
            Ordered {displayNumber(line.ordered)} ·{" "}
            {"received" in line ? "Actual" : "Completed"}{" "}
            {displayNumber(line.actual)} ·{" "}
            <strong>
              Closing {displayNumber(line.closing)} {line.unit}
            </strong>
          </p>
          {line.reserved && Number(line.reserved) > 0 && (
            <small>
              {displayNumber(line.reserved)} reserved units will be released.
            </small>
          )}
        </article>
      ))}
    </div>
  );
}
function shown(value: unknown, key: string): string {
  if (value == null) return "—";
  if (Array.isArray(value))
    return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  if (typeof value === "object") return "Updated details";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text))
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(text + "T00:00:00Z"));
  return /^-?\d+(\.\d+)?$/.test(text)
    ? displayNumber(text)
    : ["state", "mode", "billing_event"].includes(key)
      ? humanLabel(text)
      : text;
}
export function TransactionControls({
  entity,
  id,
  onDone,
  version,
  currency = "IDR",
}: {
  entity: string;
  id: string;
  onDone: () => void;
  version?: number;
  currency?: string;
}) {
  const erp = useERP(),
    [page, setPage] = useState(1),
    [mode, setMode] = useState<"close" | "variance" | null>(null),
    [reason, setReason] = useState(""),
    [ack, setAck] = useState(false);
  const result = useERPPage("controls/" + entity, "", "", page, id),
    control = result.data.rows[0] as unknown as Control | undefined;
  const preview = control?.closure_preview,
    matching = control?.matching;
  const canClose =
    preview &&
    erp.can(preview.source_type === "order" ? "sales" : "purchase", "approve");
  const done = () => {
    setMode(null);
    setReason("");
    setAck(false);
    result.refresh();
    onDone();
  };
  if (result.loading)
    return (
      <p className="text-xs text-muted" role="status">
        Loading document controls…
      </p>
    );
  if (result.error)
    return (
      <p className="erp-notice" role="alert">
        {result.error}{" "}
        <button type="button" className="underline" onClick={result.refresh}>
          Retry controls
        </button>
      </p>
    );
  if (!control) return null;
  const isClosed = Boolean(control.closure);
  return (
    <section className="transaction-controls" aria-label="Document controls">
      {control.closure && (
        <section className="erp-notice">
          <h3>Remaining quantities closed</h3>
          <p>{control.closure.reason}</p>
          <p className="text-xs">
            Approved by {control.closure.approver} ·{" "}
            {stamp(control.closure.created_at)}
          </p>
          <QuantityReview lines={control.closure.lines} />
          <p className="text-xs">
            Original quantities are retained. Posted stock, invoices and
            payments remain recorded.
          </p>
        </section>
      )}
      {preview && !isClosed && canClose && (
        <section className="erp-notice">
          <h3>Close remaining quantities</h3>
          <p>
            Stop future{" "}
            {preview.source_type === "order" ? "deliveries" : "receipts"} for
            the remaining items. Review completed quantities and linked billing
            before approval.
          </p>
          {preview.blockers.length > 0 && (
            <ul className="list-disc pl-4">
              {preview.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!preview.can_close}
            onClick={() => {
              setReason("");
              setMode("close");
            }}
          >
            Review closure
          </Button>
        </section>
      )}
      {matching && (
        <section className="erp-notice" aria-label="Purchase matching review">
          <h3>PO / receipt / bill matching</h3>
          <p>{matching.purchase_number}</p>
          <div className="control-lines">
            {matching.lines.map((line) => (
              <article key={line.id}>
                <strong>{line.product}</strong>
                <p>
                  Ordered {displayNumber(line.ordered)} · Received{" "}
                  {displayNumber(line.received)} · Billed elsewhere{" "}
                  {displayNumber(line.billed_elsewhere)} · This bill{" "}
                  {displayNumber(line.bill_quantity)} {line.unit}
                </p>
                <p>
                  PO price {money(line.agreed_price, currency)} · Bill price{" "}
                  {money(line.bill_price, currency)}
                </p>
                <p>
                  {line.quantity_valid
                    ? "Quantity matches receipts"
                    : "Quantity exceeds available receipts"}{" "}
                  · Price variance {money(line.price_variance, currency)}
                </p>
              </article>
            ))}
          </div>
          {control.variance_review && (
            <p>
              Reviewed by {control.variance_review.reviewer} ·{" "}
              {stamp(control.variance_review.created_at)} —{" "}
              {control.variance_review.reason}
              {!control.variance_review.current
                ? " · Details changed; review again."
                : ""}
            </p>
          )}
          {erp.can("finance", "approve") && version != null && (
            <div className="erp-actions">
              {matching.has_variance && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!matching.quantity_valid}
                  onClick={() => {
                    setReason("");
                    setAck(false);
                    setMode("variance");
                  }}
                >
                  Review price variance
                </Button>
              )}
              <ERPActionButton
                action="fin_issue_document"
                payload={{ id, version }}
                reason
                onDone={done}
                disabled={
                  !matching.quantity_valid ||
                  (matching.has_variance && !control.variance_review?.current)
                }
              >
                Approve and issue
              </ERPActionButton>
            </div>
          )}
          <p className="text-xs">
            Price differences require an explicit review. Quantities cannot
            exceed actual receipts; no automatic tolerance or write-off is
            applied.
          </p>
        </section>
      )}
      <section
        aria-label="Correction guidance"
        className="text-xs text-muted leading-relaxed"
      >
        <h3 className="font-semibold text-foreground">Corrections</h3>
        {control.kind === "billing" ? (
          <p>
            Void drafts before replacing them. Correct issued invoices with a
            linked credit note and apply the credit. For an issued advance
            request, reverse or move active allocations before cancellation.
            Cancelling a request does not refund money.
          </p>
        ) : control.kind === "payment" ? (
          <p>
            Reverse or move allocations to correct a matching mistake. A
            verified payment can be voided only after active allocations are
            reversed. Record actual refunds separately.
          </p>
        ) : control.kind === "movement" ? (
          <p>
            Cancel an unposted draft. Posted stock needs an authorized reversal
            when allowed. Use a claim/return after customer receipt or order
            closure; do not edit posted quantities.
          </p>
        ) : (
          <p>
            Keep completed receipts and deliveries. Use an approved change
            request for agreed quantity changes; use a claim, credit or return
            for corrections after billing or receipt. Closing remaining
            quantities does not settle an outstanding balance.
          </p>
        )}
      </section>
      <section aria-label="Document history">
        <h3 className="text-sm font-semibold">Document history</h3>
        {control.history.length === 0 ? (
          <p className="text-xs text-muted">
            No events captured since transaction controls were enabled. Earlier
            records remain available in the audit log.
          </p>
        ) : (
          <ol className="control-history">
            {control.history.map((event) => (
              <li key={event.id}>
                <strong>{eventTitle(event.action)}</strong>
                <p>
                  {event.actor} · {stamp(event.created_at)}
                </p>
                {event.reason && <p>{event.reason}</p>}
                <details>
                  <summary>View changes</summary>
                  {event.changes.map((change, i) => {
                    const keys = Array.from(
                      new Set([
                        ...Object.keys(change.before),
                        ...Object.keys(change.after),
                      ]),
                    ).filter(
                      (key) =>
                        ![
                          "version",
                          "review_token",
                          "document_version",
                          "purchase_version",
                        ].includes(key) &&
                        JSON.stringify(change.before[key]) !==
                          JSON.stringify(change.after[key]),
                    );
                    if (!keys.length) return null;
                    const created = keys.every(
                      (key) => change.before[key] == null,
                    );
                    return (
                      <section
                        key={i}
                        className={
                          "history-change-group" +
                          (created ? " is-created" : "")
                        }
                        aria-label={
                          humanLabel(change.table.replace(/^erp_/, "")) +
                          " changes"
                        }
                      >
                        <h4>{humanLabel(change.table.replace(/^erp_/, ""))}</h4>
                        <div
                          className="history-change-heading"
                          aria-hidden="true"
                        >
                          <span>Field</span>
                          {!created && <span>Before</span>}
                          <span>{created ? "Initial value" : "After"}</span>
                        </div>
                        <dl className="control-diff">
                          {keys.map((key) => (
                            <div key={key}>
                              <dt>{humanLabel(key)}</dt>
                              <dd>
                                {!created && (
                                  <span className="history-value history-value-before">
                                    <span className="sr-only">Before: </span>
                                    {shown(change.before[key], key)}
                                  </span>
                                )}
                                <span
                                  className={
                                    "history-value history-value-after" +
                                    (key === "state" ? " is-state" : "")
                                  }
                                >
                                  <span className="sr-only">
                                    {created ? "Initial value: " : "After: "}
                                  </span>
                                  {shown(change.after[key], key)}
                                </span>
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </section>
                    );
                  })}
                </details>
              </li>
            ))}
          </ol>
        )}
        {result.data.total > 20 && (
          <div className="erp-actions">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous history
            </Button>
            <span className="text-xs">Page {page}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={page * 20 >= result.data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next history
            </Button>
          </div>
        )}
        {control.amendments.map((a) => (
          <p key={a.id} className="erp-notice text-xs">
            Approved amendment · {a.actor} · {stamp(a.created_at)} — {a.reason}
          </p>
        ))}
      </section>
      {mode && (
        <ERPModal
          title={
            mode === "close"
              ? "Approve remaining-quantity closure"
              : "Review supplier price variance"
          }
          description="Review the current source quantities and financial consequences. This decision is recorded in document history."
          onClose={() => setMode(null)}
        >
          {mode === "close" && preview ? (
            <ERPForm
              action={
                preview.source_type === "order"
                  ? "close_order"
                  : "close_purchase"
              }
              payload={{
                id,
                version: preview.version,
                review_token: preview.review_token,
                reason,
              }}
              onDone={done}
              label="Approve closure"
              disabled={!preview.can_close}
            >
              <QuantityReview lines={preview.lines} />
              {preview.financial && (
                <p className="erp-notice">
                  Delivered / received value:{" "}
                  {money(preview.financial.actual_value, currency)} · Advance
                  requests:{" "}
                  {money(preview.financial.advance_requested, currency)}
                </p>
              )}
              <p className="erp-notice">
                Remaining quantities will be closed and active sales
                reservations released. Existing stock and financial documents
                remain unchanged. Final billing for completed quantities remains
                available. Closure cannot be reopened from this form.
              </p>
              <ERPField name="reason" label="Closure reason">
                <textarea
                  required
                  minLength={3}
                  maxLength={150}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </ERPField>
            </ERPForm>
          ) : (
            matching && (
              <ERPForm
                action="fin_review_variance"
                payload={{
                  id,
                  version,
                  review_token: matching.review_token,
                  reason,
                  acknowledged: ack,
                }}
                onDone={done}
                label="Approve variance review"
              >
                <div className="control-lines">
                  {matching.lines
                    .filter((l) => Number(l.price_variance) !== 0)
                    .map((l) => (
                      <article key={l.id}>
                        <strong>{l.product}</strong>
                        <p>
                          PO price {money(l.agreed_price, currency)} → Bill
                          price {money(l.bill_price, currency)}
                        </p>
                        <p>Variance: {money(l.price_variance, currency)}</p>
                      </article>
                    ))}
                </div>
                <ERPField name="reason" label="Review reason">
                  <textarea
                    required
                    minLength={10}
                    maxLength={2000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </ERPField>
                <ERPField name="acknowledged" label="Variance acknowledgement">
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={ack}
                      onChange={(e) => setAck(e.target.checked)}
                    />
                    I reviewed the price difference and supporting supplier
                    evidence. This does not authorize excess receiving
                    quantities.
                  </label>
                </ERPField>
              </ERPForm>
            )
          )}
        </ERPModal>
      )}
    </section>
  );
}
