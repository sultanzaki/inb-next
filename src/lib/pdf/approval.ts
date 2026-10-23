export type ApprovalStamp = {
  name: string;
  actorId?: string;
  at: string;
  eventId: string;
  recordId: string;
  action: string;
};
const rules: Record<string, { states: string[]; actions: string[] }> = {
  manufacturing_orders: {
    states: ["closed"],
    actions: ["close_manufacturing_order"],
  },
  incoming_inspections: {
    states: ["pass", "fail"],
    actions: ["finalize_incoming_inspection"],
  },
  warehouse_transfers: {
    states: ["in_transit", "partial", "received", "closed"],
    actions: ["dispatch_warehouse_transfer", "close_warehouse_transfer"],
  },
  quotes: {
    states: ["issued", "accepted", "rejected", "expired", "superseded"],
    actions: ["issue_quote", "approve_quote"],
  },
  purchases: {
    states: ["confirmed", "partial", "received", "closed"],
    actions: ["confirm_purchase"],
  },
  movements: {
    states: ["posted"],
    actions: ["post_move", "dispatch_pallet_delivery"],
  },
  production: { states: ["posted"], actions: ["post_move"] },
  fin_documents: {
    states: ["issued", "partially_paid", "paid", "overdue"],
    actions: ["fin_issue_document"],
  },
};
export function approvalActions(entity: string, state: string) {
  return rules[entity]?.states.includes(state) ? rules[entity].actions : [];
}
/** Only actual recorded business actions can attest a document. Never infer from its downloader. */
export function approvalFromEvents(
  entity: string,
  recordId: string,
  state: string,
  events: Record<string, unknown>[],
): ApprovalStamp | null {
  const actions = approvalActions(entity, state);
  for (const event of events) {
    if (!actions.includes(String(event.action))) continue;
    if (
      event.record_id &&
      (event.record_id !== recordId || event.entity !== entity)
    )
      continue;
    if (
      !event.actor ||
      !event.id ||
      !event.created_at ||
      !Number.isFinite(Date.parse(String(event.created_at)))
    )
      continue;
    return {
      name: String(event.actor),
      actorId: event.actor_id ? String(event.actor_id) : undefined,
      at: String(event.created_at),
      eventId: `${event.record_id ? "WORK" : "ERP"}-${event.id}`,
      recordId,
      action: String(event.action).replaceAll("_", " "),
    };
  }
  return null;
}
export function approvalLines(stamp: ApprovalStamp): [string, string][] {
  return [
    ["Recorded by", stamp.name],
    ["Action", stamp.action],
    [
      "Recorded at",
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Jakarta",
        dateStyle: "medium",
        timeStyle: "medium",
        hour12: false,
      }).format(new Date(stamp.at)) + " WIB",
    ],
    ["Audit reference", stamp.eventId],
    ["Record ID", stamp.recordId],
  ];
}
