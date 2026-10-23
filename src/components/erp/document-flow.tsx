"use client";
import { RecordSkeleton } from "@/components/workspace/record-loading";
import { useERPPage } from "./data";
import { humanLabel, money } from "@/lib/erp/ux";
import { useERP } from "./context";
const routes: Record<string, string> = {
  quotes: "/dashboard/sales?view=quotes",
  orders: "/dashboard/sales?view=orders",
  movements: "/dashboard/warehouse?view=movements",
  purchases: "/dashboard/purchase?view=purchases",
  fin_documents: "/dashboard/finance?view=documents",
  fin_payments: "/dashboard/finance?view=payments",
};
export function DocumentFlow({ entity, id }: { entity: string; id: string }) {
  const result = useERPPage("flow/" + entity, "", "", 1, id);
  return (
    <section className="erp-document-flow" aria-label="Document flow">
      <h3 className="text-sm font-semibold">Document journey</h3>
      {result.loading ? (
        <RecordSkeleton compact label="Loading linked documents…" />
      ) : result.error ? (
        <p className="text-xs text-muted">
          {result.error}{" "}
          <button type="button" className="underline" onClick={result.refresh}>
            Retry
          </button>
        </p>
      ) : result.data.rows.length === 0 ? (
        <p className="text-xs text-muted">No linked documents yet.</p>
      ) : (
        <div className="document-journey">
          <ol className="document-journey-stages">
            {(["purchases", "fin_purchases"].includes(entity) ||
            result.data.rows.some(
              (row) =>
                String((row as unknown as Record<string, unknown>).entity) ===
                "purchases",
            )
              ? [
                  ["purchases", "Purchase order"],
                  ["movements", "Goods movement"],
                  ["fin_documents", "Billing"],
                  ["fin_payments", "Payment"],
                ]
              : [
                  ["quotes", "Quotation"],
                  ["orders", "Sales order"],
                  ["movements", "Goods movement"],
                  ["fin_documents", "Billing"],
                  ["fin_payments", "Payment"],
                ]
            ).map(([kind, label], index) => {
              const documents = result.data.rows
                .map((row) => row as unknown as Record<string, string>)
                .filter((row) => row.entity === kind);
              return (
                <li
                  key={kind}
                  className="document-stage"
                  data-present={documents.length > 0}
                >
                  <div className="document-stage-heading">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <h4>{label}</h4>
                    <small>{documents.length}</small>
                  </div>
                  <div className="document-stage-records">
                    {documents.length ? (
                      documents.map((r) => (
                        <a
                          key={r.entity + r.id}
                          href={
                            routes[r.entity] +
                            "&record=" +
                            encodeURIComponent(r.id) +
                            "&q=" +
                            encodeURIComponent(r.number || "")
                          }
                          className="document-journey-card"
                          aria-current={
                            r.id === id &&
                            (r.entity === entity ||
                              (entity === "fulfillment" &&
                                r.entity === "orders"))
                              ? "page"
                              : undefined
                          }
                        >
                          <strong>{r.number}</strong>
                          <span>{humanLabel(r.state)}</span>
                          <small>
                            {r.date}
                            {r.amount && r.currency
                              ? " · " + money(r.amount, r.currency)
                              : ""}
                          </small>
                        </a>
                      ))
                    ) : (
                      <p className="document-stage-empty">No linked record</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}
export function DispatchReadiness({
  orderId,
  movementId,
}: {
  orderId: string;
  movementId?: string;
}) {
  const erp = useERP();
  const result = useERPPage(
    movementId ? "delivery-readiness" : "dispatch_status",
    "",
    "",
    1,
    movementId || orderId,
  );
  const record = result.data.rows[0] as unknown as
    Record<string, unknown> | undefined;
  const status = movementId
    ? (record?.finance as Record<string, unknown> | undefined)
    : record;
  return (
    <section className="erp-notice" aria-label="Delivery readiness">
      <strong>
        {movementId ? "Delivery readiness" : "Financial readiness"}
      </strong>
      {result.loading ? (
        <RecordSkeleton
          compact
          label="Checking payment and credit requirements…"
        />
      ) : result.error ? (
        <p role="alert">
          {result.error}{" "}
          <button type="button" className="underline" onClick={result.refresh}>
            Retry
          </button>
        </p>
      ) : (
        <>
          {Array.isArray(record?.checks) && (
            <ul className="my-2 space-y-1">
              {(
                record.checks as { id: string; label: string; ready: boolean }[]
              ).map((c) => (
                <li key={c.id}>
                  {c.ready ? "Ready" : "Action needed"} · {c.label}
                </li>
              ))}
            </ul>
          )}
          <p>
            {String(
              status?.reason || "Review financial requirements before posting.",
            )}
          </p>
          {status?.required != null && (
            <p>
              Required:{" "}
              {money(String(status.required), String(status.currency || "IDR"))}{" "}
              · Verified allocated:{" "}
              {money(String(status.paid), String(status.currency || "IDR"))}
            </p>
          )}
          {erp.can("finance") && status?.cleared === false && (
            <a
              className="underline"
              href={"/dashboard/finance?view=orders&record=" + orderId}
              target="_blank"
              rel="noopener noreferrer"
            >
              Review payment terms and allocation
            </a>
          )}
          <button type="button" className="underline" onClick={result.refresh}>
            Recheck readiness
          </button>
          <p className="text-xs">
            Posting also rechecks stock, lot release, expiry and certificate
            requirements. Financial approval alone does not confirm payment.
          </p>
        </>
      )}
    </section>
  );
}
