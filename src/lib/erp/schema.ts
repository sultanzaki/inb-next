import { operationalSchemas } from "./operational-schema";
import { z } from "zod";
const id = z.uuid(),
  optionalId = z.union([id, z.literal("")]).optional();
const text = z.string().trim().max(1000),
  short = z.string().trim().min(1).max(150);
const qty = z
  .string()
  .transform((v) => v.replace(",", "."))
  .pipe(
    z
      .string()
      .regex(
        /^\d{1,12}(\.\d{1,6})?$/,
        "Use a decimal number with at most six decimal places.",
      ),
  );
const base = { id: optionalId, reason: text.optional() };
const versioned = {
  id: optionalId,
  version: z.number().int().positive().optional(),
};
const transition = { id, version: z.number().int().positive() };
const optionalDate = z.union([z.iso.date(), z.literal("")]);
const contactFields = {
  contact: text,
  email: z.union([z.email(), z.literal("")]),
  phone: text,
};
const modules = z.enum([
  "quality",
  "warehouse",
  "production",
  "sales",
  "purchase",
  "crm",
  "documents",
  "finance",
  "service",
]);
const moveLine = z.object({
  product_id: optionalId,
  lot_id: optionalId,
  lot_number: short.optional(),
  mfg_date: z.iso.date().optional(),
  unit_id: id,
  quantity: qty,
});
const quoteLine = z.object({
  product_id: id,
  unit_id: id,
  quantity: qty,
  price: qty,
  discount: qty,
});
export const actionSchemas = {
  ...operationalSchemas,
  save_supplier: z.object({
    ...versioned,
    name: short,
    ...contactFields,
    address: text,
    tax_id: text,
    payment_terms: text,
    active: z.boolean(),
  }),
  save_material: z.object({
    ...versioned,
    code: z.string().trim().min(1).max(40),
    name: short,
    unit_id: id,
    minimum_stock: qty,
    active: z.boolean(),
  }),
  save_purchase: z.object({
    ...versioned,
    supplier_id: id,
    date: z.iso.date(),
    expected_date: z.iso.date(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    terms: text,
    lines: z
      .array(z.object({ material_id: id, quantity: qty, price: qty }))
      .min(1)
      .max(100),
  }),
  confirm_purchase: z.object(transition),
  cancel_purchase: z.object({ ...transition, reason: short }),
  receive_purchase: z.object({
    hold: z.boolean().optional(),
    ...transition,
    request_key: id,
    date: z.iso.date(),
    location_id: id,
    reason: text,
    lines: z
      .array(
        z.object({
          line_id: id,
          quantity: qty,
          lot_number: short,
          expiry_date: optionalDate,
        }),
      )
      .min(1)
      .max(100),
  }),
  reverse_material_transaction: z.object({ id, reason: short }),
  issue_material: z.object({
    request_key: id,
    lot_id: id,
    location_id: id,
    quantity: qty,
    date: z.iso.date(),
    reason: short,
  }),
  save_opportunity: z.object({
    ...versioned,
    title: short,
    company: short,
    ...contactFields,
    source: text,
    notes: text,
    owner_id: id,
    expected_value: qty,
    currency: z.string().regex(/^[A-Z]{3}$/),
    probability: z.number().int().min(0).max(100),
    expected_close: optionalDate,
  }),
  stage_opportunity: z.object({
    ...transition,
    stage: z.enum(["lead", "qualified", "proposal", "won", "lost"]),
    reason: short,
  }),
  convert_opportunity: z.object({ ...transition, customer_id: optionalId }),
  save_crm_activity: z.object({
    opportunity_id: id,
    title: short,
    kind: z.enum(["call", "email", "meeting", "task"]),
    due_date: z.iso.date(),
    assigned_to: id,
    notes: text,
  }),
  complete_crm_activity: z.object({
    id,
    state: z.enum(["done", "cancelled"]),
    notes: text,
  }),
  save_product_document: z.object({
    ...versioned,
    product_id: id,
    kind: z.enum(["SDS", "TDS", "HALAL", "ISO", "OTHER"]),
    language: z.enum(["en", "id"]),
    title: short,
    file_url: z
      .url()
      .max(2000)
      .refine((v) => {
        if (!URL.canParse(v)) return false;
        const u = new URL(v);
        return u.protocol === "https:" && !u.username && !u.password;
      }, "Use an HTTPS document link without embedded credentials."),
    effective_date: z.iso.date(),
    expiry_date: optionalDate,
    notes: text,
  }),
  publish_product_document: z.object(transition),
  withdraw_product_document: z.object({ ...transition, reason: short }),
  set_series: z.object({
    product_id: id,
    series: z
      .string()
      .regex(
        /^[0-9]{1,20}$/,
        "Enter the unique numeric product series, preserving leading zeros.",
      ),
  }),
  hold_lot: z.object({ id, hold: z.boolean(), reason: short }),
  create_return: z.object({
    delivery_id: id,
    lot_id: id,
    location_id: id,
    quantity: qty,
    reason: short,
  }),
  receive_return: z.object({ id, reason: short }),
  cancel_return: z.object({ id, reason: short }),
  dispose_return: z.object({
    id,
    decision: z.enum(["release", "scrap"]),
    reason: short,
  }),
  assign_task: z.object({
    task_id: z.string().min(1).max(100),
    user_id: optionalId,
    due_date: z.union([z.iso.date(), z.literal("")]).optional(),
  }),
  set_module: z.object({
    module: modules,
    state: z.enum(["active", "read_only", "disabled"]),
  }),
  reset_access: z.object({ user_id: id, module: modules }),
  set_access: z
    .object({
      user_id: id,
      module: modules,
      read: z.boolean(),
      write: z.boolean(),
      approve: z.boolean(),
    })
    .refine(
      (v) => v.read || (!v.write && !v.approve),
      "Read access is required for write or approval access.",
    ),
  save_unit: z.object({
    code: z.string().trim().min(1).max(20),
    name: z.string().trim().min(1).max(80),
  }),
  save_location: z.object({
    code: z.string().trim().min(1).max(30),
    name: z.string().trim().min(1).max(100),
  }),
  save_conversion: z.object({
    product_id: id,
    unit_id: id,
    factor: qty,
    is_base: z.boolean(),
  }),
  save_customer: z.object({
    ...base,
    name: z.string().trim().min(1).max(200),
    contact: text,
    email: z.union([z.email(), z.literal("")]),
    phone: text,
    tax_id: text,
    billing_address: text,
    shipping_address: text,
    payment_terms: text,
  }),
  save_move: z.object({
    ...base,
    version: z.number().int().positive().optional(),
    kind: z.enum(["receipt", "production", "transfer", "issue"]),
    date: z.iso.date(),
    from_location: optionalId,
    to_location: optionalId,
    lines: z.array(moveLine).min(1).max(100),
  }),
  post_move: z.object({ id, version: z.number().int().positive() }),
  cancel_move: z.object({ id, reason: short }),
  reverse_move: z.object({ id, reason: short }),
  release_lot: z.object({ id, release: z.boolean(), reason: short }),
  create_count: z.object({
    location_id: id,
    scheduled_date: z.iso.date(),
    blind: z.boolean(),
    reason: text,
  }),
  assign_count: z.object({ id, user_id: id }),
  start_count: z.object({ id }),
  count_line: z.object({ id, lot_id: id, quantity: qty }),
  count_add_lot: z.object({
    id,
    product_id: id,
    lot_number: short,
    mfg_date: z.union([z.iso.date(), z.literal("")]).optional(),
  }),
  submit_count: z.object({ id }),
  approve_count: z.object({ id, reason: short }),
  cancel_count: z.object({ id, reason: short }),
  save_quote: z.object({
    ...base,
    version: z.number().int().positive().optional(),
    customer_id: id,
    opportunity_id: optionalId,
    date: z.iso.date(),
    valid_until: z.iso.date(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    terms: text,
    delivery_terms: text,
    lead_time: text,
    tax_rate: qty,
    freight: qty,
    lines: z.array(quoteLine).min(1).max(100),
  }),
  issue_quote: z.object({ id, version: z.number().int().positive() }),
  approve_quote: z.object({
    id,
    version: z.number().int().positive(),
    reason: short,
  }),
  return_quote: z.object({ id, reason: short }),
  accept_quote: z.object({ id }),
  reject_quote: z.object({ id }),
  cancel_quote: z.object({ id, reason: short }),
  revise_quote: z.object({ id }),
  convert_quote: z.object({ id, customer_reference: text.optional() }),
  reserve: z.object({
    order_line_id: id,
    lot_id: id,
    location_id: id,
    quantity: qty,
  }),
  unreserve: z.object({ id, reason: short }),
  close_order: z.object({ id, reason: short }),
  create_delivery: z.object({
    order_id: id,
    reason: text,
    lines: z
      .array(z.object({ reservation_id: id, quantity: qty }))
      .min(1)
      .max(100),
  }),
} as const;
export type ERPAction = keyof typeof actionSchemas;
export type ModuleKey =
  | "quality"
  | "warehouse"
  | "production"
  | "sales"
  | "purchase"
  | "crm"
  | "documents"
  | "finance"
  | "service";
export type ModuleAccess = {
  key: ModuleKey;
  state: "active" | "read_only" | "disabled";
  read: boolean;
  write: boolean;
  approve: boolean;
};
export type ERPContext = { modules: ModuleAccess[]; admin: boolean };
export type ERPUom = {
  id: string;
  code: string;
  factor: string;
  is_base: boolean;
};
export type ERPLine = {
  product_id: string;
  product: string;
  code: string;
  unit_id: string;
  unit: string;
  quantity: string;
  base_quantity: string;
  base_unit: string;
  factor: string;
  price?: string;
  discount?: string;
  amount?: string;
  lot_id?: string;
  lot?: string;
  mfg_date?: string;
  reservation_id?: string;
  order_line_id?: string;
  coa?: Record<string, unknown> | null;
};
export type ERPRow = {
  root_id?: string;
  sales_order?: { id: string; number: string; state: string } | null;
  id: string;
  number?: string;
  name?: string;
  label?: string;
  code?: string;
  state?: string;
  display_state?: string;
  kind?: string;
  date?: string;
  valid_until?: string;
  currency?: string;
  revision?: number;
  version?: number;
  customer_id?: string;
  customer?: string;
  customer_data?: {
    name?: string;
    billing_address?: string;
    contact?: string;
    email?: string;
    phone?: string;
  };
  customer_reference?: string;
  opportunity_id?: string;
  quote_id?: string;
  reason?: string;
  source?: string;
  destination?: string;
  location?: string;
  location_id?: string;
  from_location?: string;
  to_location?: string;
  product?: string;
  product_id?: string;
  lot_number?: string;
  lot_id?: string;
  qc_status?: string;
  expiry_date?: string;
  mfg_date?: string;
  unit?: string;
  on_hand?: string;
  available?: string;
  reserved?: string;
  delta?: string;
  blind?: boolean;
  scheduled_date?: string;
  assigned?: string;
  contact?: string;
  email?: string;
  phone?: string;
  tax_id?: string;
  billing_address?: string;
  shipping_address?: string;
  payment_terms?: string;
  terms?: string;
  delivery_terms?: string;
  lead_time?: string;
  tax_rate?: string;
  freight?: string;
  units?: ERPUom[];
  lines?: ERPLine[];
  totals?: Record<string, string>;
  snapshot?: Record<string, unknown>;
  reservations?: ERPReservation[];
  deliveries?: { id: string; number: string; state: string }[];
  username?: string;
  module?: ModuleKey;
  can_read?: boolean;
  can_write?: boolean;
  can_approve?: boolean;
  user_id?: string;
  series?: string;
  held?: boolean;
  batch_number?: number;
  source_lot_id?: string;
  inspection_id?: string;
  delivery_id?: string;
  delivery?: string;
  quantity?: string;
  decision_reason?: string;
  title?: string;
  description?: string;
  href?: string;
  assigned_to?: string;
  due_date?: string;
  assignee?: string;
};
export type ERPReservation = {
  id: string;
  order_line_id: string;
  lot_id: string;
  location_id: string;
  lot: string;
  location: string;
  remaining: string;
  quantity: string;
  state: string;
  unit: string;
  product: string;
};
export type CountLine = {
  lot_id: string;
  product_id: string;
  product: string;
  lot: string;
  unit: string;
  counted: string | null;
  baseline: string | null;
  difference: string | null;
};
export type OrderLine = {
  id: string;
  product_id: string;
  product: string;
  code: string;
  unit: string;
  quantity: string;
  delivered: string;
  reserved: string;
  unreserved: string;
  outstanding: string;
};
export type ERPPage = {
  rows: ERPRow[];
  total: number;
  page: number;
  page_size: number;
};
/** Preserve decimal strings, including trailing stock precision, without IEEE-754 calculations. */
export function decimal(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "—";
  const [integer, fraction = ""] = String(value).split(".");
  return (
    integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    (fraction.replace(/0+$/, "") ? "." + fraction.replace(/0+$/, "") : "")
  );
}
