import { z } from "zod";
export type Column = {
  key: string;
  label: string;
  type?: "number" | "date" | "text" | "boolean";
  hidden?: boolean;
  group?: string;
};
const c = (
  key: string,
  label: string,
  type: Column["type"] = "text",
  hidden = false,
): Column => ({ key, label, type, hidden });
const common = [
  c("state", "Status"),
  c("date", "Date", "date"),
  c("created_at", "Created", "date", true),
];
const money = [
  c("currency", "Currency"),
  c("amount", "Amount", "number"),
  c("outstanding", "Outstanding", "number"),
];
export const entityColumns: Record<string, Column[]> = {
  users: [
    c("nama_lengkap", "Name"),
    c("username", "Username"),
    c("role", "Role"),
    c("is_active", "Active", "boolean"),
    c("created_at", "Created", "date", true),
  ],
  stock: [
    c("product", "Product"),
    c("lot_number", "Lot"),
    c("location", "Location"),
    c("on_hand", "On hand", "number"),
    c("reserved", "Reserved", "number"),
    c("available", "Available", "number"),
    c("unit", "Unit"),
    c("state", "Status"),
  ],
  lots: [
    c("number", "Lot"),
    c("product", "Product"),
    c("unit", "Unit"),
    c("state", "Status"),
    c("mfg_date", "Manufactured", "date"),
    c("expiry_date", "Expires", "date"),
  ],
  catalog: [c("name", "Product"), c("code", "Code")],
  units: [c("name", "Unit"), c("code", "Code")],
  locations: [
    c("name", "Location"),
    c("code", "Code"),
    c("warehouse", "Warehouse"),
  ],
  customers: [
    c("name", "Customer"),
    c("contact", "Contact"),
    c("email", "Email"),
    c("phone", "Phone"),
    c("tax_id", "Tax ID", "text", true),
  ],
  production: [
    c("number", "Production"),
    c("destination", "Destination"),
    ...common,
    c("reason", "Reason", "text", true),
  ],
  movements: [
    c("number", "Movement"),
    c("kind", "Type"),
    c("destination", "To"),
    ...common,
  ],
  counts: [
    c("number", "Stock count"),
    c("location", "Location"),
    c("assigned", "Assigned to"),
    c("state", "Status"),
    c("scheduled_date", "Scheduled", "date"),
    c("created_at", "Created", "date", true),
  ],
  ledger: [
    c("number", "Movement"),
    c("product", "Product"),
    c("lot_number", "Lot"),
    c("location", "Location"),
    c("delta", "Change", "number"),
    c("unit", "Unit"),
    c("state", "Status"),
    c("created_at", "Created", "date"),
  ],
  quotes: [
    c("number", "Quotation"),
    c("customer", "Customer"),
    c("totals.total", "Total", "number"),
    c("currency", "Currency"),
    ...common,
    c("valid_until", "Valid until", "date"),
    c("revision", "Revision", "number", true),
  ],
  orders: [
    c("number", "Sales order"),
    c("customer", "Customer"),
    c("customer_reference", "Customer reference"),
    c("state", "Status"),
  ],
  fulfillment: [
    c("number", "Sales order"),
    c("customer", "Customer"),
    c("customer_reference", "Customer reference"),
    c("state", "Status"),
  ],
  returns: [
    c("number", "Return"),
    c("product", "Product"),
    c("lot_number", "Lot"),
    c("quantity", "Quantity", "number"),
    c("unit", "Unit"),
    c("delivery", "Delivery"),
    c("state", "Status"),
    c("created_at", "Created", "date"),
  ],
  suppliers: [
    c("name", "Supplier"),
    c("contact", "Contact"),
    c("email", "Email"),
    c("phone", "Phone"),
    c("state", "Status"),
  ],
  materials: [
    c("name", "Material"),
    c("code", "Code"),
    c("unit", "Unit"),
    c("state", "Status"),
  ],
  purchases: [
    c("number", "Purchase order"),
    c("supplier", "Supplier"),
    c("total", "Total", "number"),
    c("currency", "Currency"),
    ...common,
    c("expected_date", "Expected", "date"),
  ],
  material_stock: [
    c("name", "Material"),
    c("lot_number", "Lot"),
    c("location", "Location"),
    c("quantity", "On hand", "number"),
    c("unit", "Unit"),
    c("held", "On hold", "boolean"),
    c("state", "Status"),
    c("expiry_date", "Expires", "date"),
  ],
  material_ledger: [
    c("number", "Movement"),
    c("name", "Material"),
    c("lot_number", "Lot"),
    c("quantity", "Change", "number"),
    c("unit", "Unit"),
    ...common,
  ],
  opportunities: [
    c("number", "Opportunity"),
    c("company", "Company"),
    c("owner", "Owner"),
    c("expected_value", "Expected value", "number"),
    c("currency", "Currency"),
    c("expected_close", "Expected close", "date"),
    c("state", "Stage"),
  ],
  crm_activities: [
    c("title", "Activity"),
    c("company", "Company"),
    c("assignee", "Assigned to"),
    c("due_date", "Due", "date"),
    c("state", "Status"),
  ],
  product_documents: [
    c("title", "Document"),
    c("product", "Product"),
    c("kind", "Type"),
    c("revision", "Revision"),
    c("language", "Language"),
    c("effective_date", "Effective", "date"),
    c("expiry_date", "Expires", "date"),
    c("state", "Status"),
  ],
  fin_documents: [
    c("number", "Document"),
    c("party", "Counterparty"),
    c("kind", "Type"),
    ...money,
    ...common,
    c("due_date", "Due", "date"),
    c("days_overdue", "Days overdue", "number", true),
    c("external_reference", "External reference", "text", true),
  ],
  fin_payments: [
    c("number", "Payment"),
    c("name", "Counterparty"),
    c("direction", "Direction"),
    c("currency", "Currency"),
    c("amount", "Amount", "number"),
    c("available", "Unallocated", "number"),
    ...common,
    c("bank_reference", "Bank reference", "text", true),
  ],
  fin_orders: [
    c("number", "Sales order"),
    c("name", "Customer"),
    c("currency", "Currency"),
    c("amount", "Amount", "number"),
    c("terms.state", "Payment terms"),
    c("state", "Status"),
    c("created_at", "Created", "date"),
  ],
  fin_purchases: [
    c("number", "Purchase order"),
    c("name", "Supplier"),
    c("currency", "Currency"),
    c("amount", "Amount", "number"),
    c("state", "Status"),
    c("created_at", "Created", "date"),
  ],
  fin_credit_policies: [
    c("name", "Customer"),
    c("currency", "Currency"),
    c("credit_limit", "Credit limit", "number"),
    c("state", "Status"),
  ],
  fin_aging: [
    c("bucket", "Age"),
    c("party_type", "Counterparty type"),
    c("currency", "Currency"),
    c("amount", "Outstanding", "number"),
    c("count", "Documents", "number"),
  ],
  ops_cases: [
    c("number", "Case"),
    c("title", "Title"),
    c("kind", "Type"),
    c("source_number", "Source"),
    c("assignee", "Assigned to"),
    c("due_date", "Due", "date"),
    c("estimated_cost", "Estimated cost", "number", true),
    c("state", "Status"),
    c("created_at", "Created", "date"),
  ],
  ops_receipts: [
    c("number", "Delivery"),
    c("status", "Status"),
    c("created_at", "Created", "date"),
  ],
  access: [
    c("name", "User"),
    c("module", "Module"),
    c("can_read", "Read", "boolean"),
    c("can_write", "Write", "boolean"),
    c("can_approve", "Approve", "boolean"),
  ],
  series: [c("name", "Product"), c("series", "Series")],
  master_produk: [
    c("nama_produk", "Product"),
    c("kode_produk", "Code"),
    c("satuan", "Unit"),
    c("kategori", "Category"),
    c("status_halal", "Halal status"),
    c("spec_version", "Specification version", "number", true),
    c("inci_name", "INCI", "text", true),
    c("tipe_kemasan", "Packaging", "text", true),
    c("created_at", "Created", "date", true),
  ],
  hasil_uji: [
    c("no_lot", "Lot"),
    c("product_name", "Product"),
    c("tgl_sampling", "Sampling date", "date"),
    c("tgl_uji", "Test date", "date"),
    c("inspector", "Inspector"),
    c("status", "Status"),
    c("superseded", "Superseded", "boolean", true),
    c("failure_reason", "Failure reason", "text", true),
    c("spec_version", "Specification version", "number", true),
    c("created_at", "Created", "date", true),
  ],
  coa: [
    c("no_coa", "Certificate"),
    c("no_lot", "Lot"),
    c("product_name", "Product"),
    c("tanggal_rilis", "Release date", "date"),
    c("tanggal_expired", "Expires", "date"),
    c("withdrawn", "Withdrawn", "boolean"),
    c("created_at", "Created", "date", true),
  ],
  audit_log: [
    c("waktu", "Time", "date"),
    c("user_name", "Actor"),
    c("aksi", "Action"),
    c("referensi", "Reference"),
  ],
};
export const filterSchema = z.object({
  field: z.string().max(60),
  op: z.enum([
    "contains",
    "eq",
    "neq",
    "in",
    "starts",
    "gt",
    "gte",
    "lt",
    "lte",
    "empty",
    "not_empty",
  ]),
  value: z.string().max(200).default(""),
});
export const tableQuerySchema = z.object({
  filters: z.array(filterSchema).max(12).default([]),
  sorts: z
    .array(
      z.object({
        field: z.string().max(60),
        direction: z.enum(["asc", "desc"]),
      }),
    )
    .max(4)
    .default([]),
});
export type TableQuery = z.infer<typeof tableQuerySchema>;
export const emptyQuery: TableQuery = { filters: [], sorts: [] };
export function parseTableQuery(
  raw: string | null,
  entity: string,
): TableQuery {
  const value = tableQuerySchema.parse(raw ? JSON.parse(raw) : {});
  const columns = entityColumns[entity];
  if (
    !columns ||
    [...value.filters, ...value.sorts].some(
      (v) => !columns.some((c) => c.key === v.field),
    )
  )
    throw Error("Invalid table fields.");
  if (new Set(value.sorts.map((s) => s.field)).size !== value.sorts.length)
    throw Error("Choose each sort field once.");
  for (const f of value.filters) {
    const column = columns.find((c) => c.key === f.field)!;
    if (
      f.op === "in" &&
      (column.type !== "text" ||
        f.value.split(",").filter((v) => v.trim()).length === 0 ||
        f.value.split(",").length > 20)
    )
      throw Error("Choose up to 20 text values, separated by commas.");
    if (["contains", "starts"].includes(f.op) && column.type !== "text")
      throw Error("Choose an exact comparison for numeric or date fields.");
    if (
      ["gt", "gte", "lt", "lte"].includes(f.op) &&
      !["number", "date"].includes(column.type || "text")
    )
      throw Error("Choose a numeric or date field.");
    if (
      column.type === "boolean" &&
      !["empty", "not_empty"].includes(f.op) &&
      !["true", "false"].includes(f.value)
    )
      throw Error("Enter true or false for this field.");
    if (
      !["empty", "not_empty"].includes(f.op) &&
      column.type === "number" &&
      !/^-?\d+(\.\d+)?$/.test(f.value)
    )
      throw Error("Enter a valid number.");
    if (
      !["empty", "not_empty"].includes(f.op) &&
      column.type === "date" &&
      !z.iso.date().safeParse(f.value).success
    )
      throw Error("Enter a valid date.");
  }
  return value;
}
export function fieldValue(row: Record<string, unknown>, key: string): unknown {
  if (key === "product_name") {
    const snapshot = row.hasil_uji_snapshot as
      | Record<string, unknown>
      | undefined;
    const product = row.master_produk as Record<string, unknown> | undefined;
    return row.product_name ?? snapshot?.produk ?? product?.nama_produk;
  }
  return key
    .split(".")
    .reduce<unknown>(
      (v, k) =>
        v && typeof v === "object"
          ? (v as Record<string, unknown>)[k]
          : undefined,
      row,
    );
}
