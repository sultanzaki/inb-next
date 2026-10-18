"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ShieldAlert, CheckCheck, Inbox } from "lucide-react";
import { useERPPage } from "./data";
import { useERP } from "./context";
import { ERPPicker } from "./picker";
import { ERPForm, ERPField, ERPActionButton, ERPModal } from "./shared";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataPagination } from "@/components/workspace/page-ui";
import { decimal, type ERPRow } from "@/lib/erp/schema";
export function SeriesForm({ onDone }: { onDone: () => void }) {
  const [p, setP] = useState<ERPRow | null>(null),
    [series, setSeries] = useState("");
  return (
    <ERPForm
      action="set_series"
      payload={{ product_id: p?.id, series }}
      onDone={onDone}
    >
      <ERPPicker entity="catalog" label="Product" value={p} onChange={setP} />
      <ERPField
        label="Unique product series"
        hint="For INDOSTER 01 use 01. Leading zeros are retained. Locked after the first batch is posted."
      >
        <Input
          required
          inputMode="numeric"
          maxLength={20}
          value={series}
          onChange={(e) => setSeries(e.target.value)}
        />
      </ERPField>
    </ERPForm>
  );
}
export function ReturnForm({
  onDone,
}: {
  onDone: (id?: string, entity?: string) => void;
}) {
  const [delivery, setDelivery] = useState<ERPRow | null>(null),
    [lot, setLot] = useState<ERPRow | null>(null),
    [location, setLocation] = useState<ERPRow | null>(null),
    [quantity, setQuantity] = useState(""),
    [reason, setReason] = useState("");
  const details = useERPPage(
    "movements",
    "",
    "",
    1,
    delivery?.id,
    Boolean(delivery),
  );
  return (
    <ERPForm
      action="create_return"
      payload={{
        delivery_id: delivery?.id,
        lot_id: lot?.id,
        location_id: location?.id,
        quantity,
        reason,
      }}
      onDone={onDone}
    >
      <p className="erp-notice">
        Returned goods enter a separate held lot. Receipt does not make them
        available to sell. Quantities use the product base stock unit.
      </p>
      <ERPPicker
        entity="posted_deliveries"
        label="Original delivery"
        value={delivery}
        onChange={(p) => {
          setDelivery(p);
          setLot(null);
        }}
      />
      <ERPField label="Shipped lot">
        <select
          aria-label="Shipped lot"
          required
          value={lot?.id || ""}
          onChange={(e) => setLot({ id: e.target.value })}
        >
          <option value="">Select a shipped lot…</option>
          {details.data.rows[0]?.lines?.map((l) => (
            <option key={l.lot_id} value={l.lot_id}>
              {l.product} · {l.lot} · {decimal(l.base_quantity)} {l.base_unit}
            </option>
          ))}
        </select>
      </ERPField>
      <ERPPicker
        entity="locations"
        label="Return location"
        value={location}
        onChange={setLocation}
      />
      <ERPField label="Return quantity (base unit)">
        <Input
          inputMode="decimal"
          required
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </ERPField>
      <ERPField label="Return reason">
        <textarea
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </ERPField>
    </ERPForm>
  );
}
export function ReturnDetail({
  row,
  onDone,
}: {
  row: ERPRow;
  onDone: () => void;
}) {
  const erp = useERP();
  return (
    <>
      <p>
        {row.product} · {row.lot_number}
      </p>
      <p>Original delivery: {row.delivery}</p>
      <p>
        Quantity: {decimal(row.quantity)} {row.unit || "(base unit)"}
      </p>
      <p>{row.reason}</p>
      {row.decision_reason && <p>Decision: {row.decision_reason}</p>}
      <div className="erp-actions">
        {erp.can("warehouse", "write") && row.state === "requested" && (
          <>
            <ERPActionButton
              action="receive_return"
              payload={{ id: row.id }}
              reason
              onDone={onDone}
            >
              Receive into quarantine
            </ERPActionButton>
            <ERPActionButton
              action="cancel_return"
              payload={{ id: row.id }}
              reason
              destructive
              onDone={onDone}
            >
              Cancel request
            </ERPActionButton>
          </>
        )}
        {row.lot_id && (
          <Link href={"/dashboard/inspeksi?lot=" + row.lot_id}>
            Inspect returned lot <ArrowUpRight className="inline size-4" />
          </Link>
        )}
        {erp.can("warehouse", "approve") && row.state === "received" && (
          <>
            <ERPActionButton
              action="dispose_return"
              payload={{ id: row.id, decision: "release" }}
              reason
              onDone={onDone}
            >
              Release after PASS
            </ERPActionButton>
            <ERPActionButton
              action="dispose_return"
              payload={{ id: row.id, decision: "scrap" }}
              reason
              destructive
              onDone={onDone}
            >
              Approve disposal
            </ERPActionButton>
          </>
        )}
      </div>
    </>
  );
}
type TraceResponse = {
  returns?: {
    id: string;
    number: string;
    state: string;
    lot_id?: string;
    lot?: string;
    quantity: string;
  }[];
  stock?: ERPRow[];
  inspection?: {
    status: string;
    date: string;
    inspector: string;
    failure_reason?: string;
    coa?: string;
  };
};
export function LotTrace({
  row,
  onDone,
}: {
  row: ERPRow;
  onDone: (id?: string, entity?: string) => void;
}) {
  const erp = useERP(),
    [page, setPage] = useState(1),
    trace = useERPPage("trace", "", "", 1, row.id),
    events = useERPPage("trace_events", "", "", page, row.id),
    extra = trace.data as typeof trace.data & TraceResponse;
  return (
    <div className="lot-trace">
      <div className="trace-identity">
        <strong>{row.number}</strong>
        <span>{row.product}</span>
        <span>
          Manufactured {row.mfg_date || "—"} · Expires {row.expiry_date || "—"}
        </span>
        {row.held && (
          <p role="status">
            <ShieldAlert className="inline size-4" /> Lot on hold. Reservations
            and shipment are blocked.
          </p>
        )}
      </div>
      <div className="erp-actions">
        {row.source_lot_id && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDone(row.source_lot_id, "lots")}
          >
            Source lot
          </Button>
        )}
        {erp.can("quality", "write") && (
          <Link
            href={
              row.inspection_id
                ? "/dashboard/inspeksi?q=" +
                  encodeURIComponent(row.number || "")
                : "/dashboard/inspeksi?lot=" + row.id
            }
          >
            {row.inspection_id ? "View inspection" : "Create inspection"}{" "}
            <ArrowUpRight className="inline size-4" />
          </Link>
        )}
        {erp.can("warehouse", "approve") && (
          <ERPActionButton
            action="hold_lot"
            payload={{ id: row.id, hold: !row.held }}
            reason
            destructive={!row.held}
            onDone={() => {
              onDone();
              trace.refresh();
            }}
          >
            {row.held ? "Remove hold" : "Hold lot"}
          </ERPActionButton>
        )}
      </div>
      {trace.error && <p role="alert">{trace.error}</p>}
      {extra.stock?.map((s) => (
        <article key={s.id} className="trace-event">
          <strong>{s.location}</strong>
          <p>
            On hand {decimal(s.on_hand)} · Reserved {decimal(s.reserved)} ·
            Available {decimal(s.available)} {s.unit}
          </p>
        </article>
      ))}
      {extra.inspection && (
        <article className="trace-event">
          <strong>Quality · {extra.inspection.status}</strong>
          <p>
            {extra.inspection.date} · {extra.inspection.inspector}
          </p>
          {extra.inspection.failure_reason && (
            <p>{extra.inspection.failure_reason}</p>
          )}
          <p>COA: {extra.inspection.coa || "Not issued"}</p>
        </article>
      )}
      {extra.returns?.map((ret) => (
        <article key={ret.id} className="trace-event">
          <strong>
            Return {ret.number} · {ret.state}
          </strong>
          <p>
            {decimal(ret.quantity)} {row.unit}
          </p>
          {ret.lot_id && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDone(ret.lot_id, "lots")}
            >
              Trace returned lot
            </Button>
          )}
        </article>
      ))}
      <h3>Movement history</h3>
      {events.error && <p role="alert">{events.error}</p>}
      {events.loading ? (
        <p role="status">Loading history…</p>
      ) : events.data.rows.length === 0 ? (
        <p>No posted movements.</p>
      ) : (
        events.data.rows.map((e) => (
          <article key={e.id} className="trace-event">
            <strong>
              {e.number} · {e.kind}
            </strong>
            <p>
              {e.date} · {e.location} · {decimal(e.delta)} {row.unit}
            </p>
            <p>{e.reason}</p>
            {Boolean(e.snapshot?.customer) && (
              <p>
                Customer:{" "}
                {String(
                  (e.snapshot?.customer as { name?: string })?.name || "—",
                )}
              </p>
            )}
          </article>
        ))
      )}
      <DataPagination
        page={page}
        pageSize={50}
        count={events.data.rows.length}
        total={events.data.total}
        onPageChange={setPage}
        loading={events.loading}
      />
    </div>
  );
}
export function WorkInbox({ compact = false }: { compact?: boolean }) {
  const erp = useERP(),
    [page, setPage] = useState(1),
    [filter, setFilter] = useState(""),
    [assignment, setAssignment] = useState<ERPRow | null>(null),
    r = useERPPage("inbox", "", filter, page);
  return (
    <section className="work-inbox">
      <div className="release-section-heading">
        <div>
          <p className="micro-label">
            {compact ? "NEEDS ATTENTION" : "YOUR WORKSPACE"}
          </p>
          <h2>{compact ? "Next actions" : "Work inbox"}</h2>
        </div>
        {compact ? (
          <Link href="/dashboard/inbox">
            View all <ArrowUpRight className="inline size-4" />
          </Link>
        ) : (
          <select
            aria-label="Filter inbox module"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All work</option>
            {erp.data?.modules
              .filter((m) => erp.can(m.key))
              .map((m) => (
                <option key={m.key} value={m.key}>
                  {m.key}
                </option>
              ))}
          </select>
        )}
      </div>
      {r.error ? (
        <p role="alert">{r.error}</p>
      ) : r.loading ? (
        <p role="status">Loading work…</p>
      ) : r.data.total === 0 ? (
        <div className="inbox-clear">
          <CheckCheck />
          <p>You are up to date. No work awaiting action.</p>
        </div>
      ) : (
        <div className="inbox-list">
          {r.data.rows.slice(0, compact ? 4 : 50).map((task) => (
            <article key={task.id}>
              <Inbox className="size-4" />
              <Link href={task.href || "/dashboard"}>
                <strong>{task.title}</strong>
                <span>{task.description}</span>
                <small>
                  {task.assignee || "Unassigned"}
                  {task.due_date ? " · Due " + task.due_date : ""}
                </small>
              </Link>
              {!compact && task.module && erp.can(task.module, "approve") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAssignment(task)}
                >
                  Assign
                </Button>
              )}
              <ArrowUpRight className="size-4" />
            </article>
          ))}
        </div>
      )}
      {!compact && (
        <DataPagination
          page={page}
          pageSize={50}
          count={r.data.rows.length}
          total={r.data.total}
          onPageChange={setPage}
          loading={r.loading}
        />
      )}
      {!compact && (
        <p className="inbox-note">
          Tasks resolve automatically when the underlying work is completed.
        </p>
      )}
      {assignment && (
        <ERPModal
          title="Assign work"
          description={
            assignment.title || "Assign an owner and optional due date."
          }
          onClose={() => setAssignment(null)}
        >
          <TaskAssignment
            row={assignment}
            onDone={() => {
              setAssignment(null);
              r.refresh();
            }}
          />
        </ERPModal>
      )}
    </section>
  );
}
function TaskAssignment({ row, onDone }: { row: ERPRow; onDone: () => void }) {
  const [owner, setOwner] = useState<ERPRow | null>(
      row.assigned_to ? { id: row.assigned_to, label: row.assignee } : null,
    ),
    [date, setDate] = useState(row.due_date || "");
  return (
    <ERPForm
      action="assign_task"
      payload={{ task_id: row.id, user_id: owner?.id || "", due_date: date }}
      onDone={onDone}
    >
      <ERPPicker
        entity="task_owners"
        label="Assigned to"
        value={owner}
        onChange={setOwner}
      />
      <Button variant="ghost" onClick={() => setOwner(null)}>
        Unassign
      </Button>
      <ERPField label="Due date (optional)">
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </ERPField>
    </ERPForm>
  );
}
