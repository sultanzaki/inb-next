import { z } from "zod";
const id = z.uuid(),
  optionalId = z.union([id, z.literal("")]).optional();
const text = z.string().trim().max(4000),
  reason = z.string().trim().min(3).max(2000);
const amount = z
  .string()
  .regex(/^\d{1,15}([.,]\d{1,6})?$/, "Use a non-negative decimal amount.");
const date = z.iso.date(),
  optDate = z.union([date, z.literal("")]).optional();
const transition = { id, version: z.number().int().positive(), reason };
const request = { request_key: id };
const evidence = z
  .array(
    z
      .url()
      .max(2000)
      .refine((v) => {
        const u = new URL(v);
        return u.protocol === "https:" && !u.username && !u.password;
      }),
  )
  .max(10);
export const operationalSchemas = {
  ops_create_case: z.object({
    ...request,
    kind: z.enum([
      "customer_claim",
      "supplier_claim",
      "receiving_exception",
      "delivery_incident",
      "quality_retest",
      "recall",
      "document_issue",
      "change_request",
      "supplier_return",
    ]),
    source_type: z.enum([
      "delivery",
      "receipt",
      "lot",
      "product",
      "order",
      "purchase",
      "document",
    ]),
    source_id: id,
    title: z.string().trim().min(1).max(200),
    description: text,
    quantity: z.union([amount, z.literal("")]).optional(),
    lot_id: optionalId,
    assigned_to: optionalId,
    due_date: optDate,
    evidence,
  }),
  ops_case_transition: z.object({
    ...transition,
    state: z.enum([
      "under_review",
      "awaiting_approval",
      "approved",
      "in_progress",
      "resolved",
      "rejected",
      "closed",
    ]),
    resolution: z
      .enum([
        "",
        "replacement",
        "refund",
        "credit",
        "return",
        "scrap",
        "correction",
        "no_action",
      ])
      .optional(),
    cost_payer: z
      .enum([
        "undecided",
        "company",
        "customer",
        "supplier",
        "carrier",
        "shared",
      ])
      .optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    settlement_amount: amount.optional(),
    estimated_cost: amount.optional(),
    actual_cost: amount.optional(),
  }),
  ops_case_comment: z.object(transition),
  ops_assign_case: z.object({
    ...transition,
    assigned_to: id,
    due_date: optDate,
  }),
  ops_delivery_receipt: z.object({
    ...request,
    delivery_id: id,
    recipient: z.string().trim().min(1).max(200),
    received_date: date,
    status: z.enum(["received", "partial", "rejected", "returned"]),
    lines: z
      .array(
        z.object({
          order_line_id: id,
          lot_id: id,
          accepted: amount,
          rejected: amount,
        }),
      )
      .min(1)
      .max(100),
    evidence: reason,
    notes: text,
  }),
  ops_material_hold: z.object({ id, hold: z.boolean(), reason }),
  ops_settlement_reference: z.object(transition),
  ops_retest: z.object(transition),
  ops_withdraw_coa: z.object({ ...transition, coa_id: id }),
  ops_replacement: z.object({
    ...transition,
    ...request,
    lot_id: id,
    location_id: id,
    quantity: amount,
  }),
  ops_supplier_return: z.object({
    ...transition,
    ...request,
    lot_id: id,
    location_id: id,
    quantity: amount,
  }),
  ops_customer_return: z.object({ ...transition, ...request, location_id: id }),
  ops_amend_order: z.object({
    ...transition,
    ...request,
    lines: z
      .array(z.object({ line_id: id, quantity: amount }))
      .min(1)
      .max(100),
  }),
  ops_amend_purchase: z.object({
    ...transition,
    ...request,
    expected_date: date,
    terms: text,
    lines: z
      .array(z.object({ line_id: id, quantity: amount }))
      .min(1)
      .max(100),
  }),
  ops_policy: z.object({
    backdate_days: z.number().int().min(0).max(3650),
    locked_through: optDate,
    dual_approval: z.boolean(),
    version: z.number().int().positive(),
  }),
  fin_terms: z.object({
    ...request,
    order_id: id,
    version: z.number().int().positive().optional(),
    mode: z.enum(["prepaid", "deposit_before", "deposit_credit", "credit"]),
    deposit_percent: amount,
    due_days: z.number().int().min(0).max(365),
    billing_event: z.enum(["order", "dispatch", "receipt"]),
  }),
  fin_approve_terms: z.object(transition),
  fin_dispatch_override: z.object({
    ...request,
    order_id: id,
    expires_on: date,
    reason,
  }),
  fin_credit_policy: z.object({
    customer_id: id,
    currency: z.string().regex(/^[A-Z]{3}$/),
    credit_limit: amount,
    on_hold: z.boolean(),
    hold_overdue: z.boolean(),
    reason,
    version: z.number().int().positive().optional(),
  }),
  fin_create_document: z
    .object({
      ...request,
      kind: z.enum([
        "payment_request",
        "invoice",
        "credit_note",
        "supplier_request",
        "supplier_bill",
        "supplier_credit",
      ]),
      order_id: optionalId,
      delivery_id: optionalId,
      purchase_id: optionalId,
      related_id: optionalId,
      case_id: optionalId,
      date,
      due_date: date,
      amount: amount.optional(),
      external_reference: text.optional(),
      notes: text.optional(),
      reason: text.optional(),
      lines: z
        .array(
          z.object({ line_id: id, quantity: amount, price: amount.optional() }),
        )
        .max(100)
        .optional(),
    })
    .superRefine((data, ctx) => {
      const source = ["invoice", "payment_request"].includes(data.kind)
        ? "order_id"
        : ["supplier_bill", "supplier_request"].includes(data.kind)
          ? "purchase_id"
          : "related_id";
      if (!data[source])
        ctx.addIssue({
          code: "custom",
          path: [source],
          message:
            source === "related_id"
              ? "Select the original issued invoice or bill."
              : "Select the source order.",
        });
      if (["invoice", "supplier_bill"].includes(data.kind)) {
        if (!data.lines?.length)
          ctx.addIssue({
            code: "custom",
            path: ["lines"],
            message:
              "Enter at least one quantity to bill, or use the remaining quantities.",
          });
      } else if (!data.amount || Number(data.amount.replace(",", ".")) <= 0)
        ctx.addIssue({
          code: "custom",
          path: ["amount"],
          message:
            "Enter an amount greater than zero. Review existing requests before creating another.",
        });
      if (data.due_date < data.date)
        ctx.addIssue({
          code: "custom",
          path: ["due_date"],
          message: "Due date cannot be before the document date.",
        });
    }),
  fin_issue_document: z.object(transition),
  fin_void_document: z.object(transition),
  fin_record_payment: z.object({
    ...request,
    direction: z.enum(["receipt", "payment", "refund", "supplier_refund"]),
    party_type: z.enum(["customer", "supplier"]),
    party_id: id,
    currency: z.string().regex(/^[A-Z]{3}$/),
    amount,
    date,
    bank_account: z.string().trim().min(1).max(200),
    bank_reference: z.string().trim().min(1).max(200),
    evidence: reason,
    notes: text,
  }),
  fin_verify_payment: z.object(transition),
  fin_void_payment: z.object(transition),
  fin_allocate: z.object({
    ...request,
    payment_id: id,
    document_id: id,
    amount,
    reason,
  }),
  fin_move_allocation: z.object({
    ...request,
    id,
    document_id: id,
    amount,
    reason,
  }),
  fin_reverse_allocation: z.object({ id, reason }),
  fin_apply_credit: z.object({
    ...request,
    credit_id: id,
    invoice_id: id,
    amount,
    reason,
  }),
  fin_collection: z.object({
    ...request,
    document_id: id,
    kind: z.enum(["follow_up", "promise", "dispute", "resolve_dispute"]),
    reason,
    promised_date: optDate,
    promised_amount: z.union([amount, z.literal("")]).optional(),
  }),
} as const;
