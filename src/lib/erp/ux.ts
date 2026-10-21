import { formatDecimal } from "../number-format";
/** Display uses Indonesian separators; transport always uses ungrouped decimal strings. */
export function displayNumber(
  value: string | number,
  options?: { editing?: boolean },
): string {
  return formatDecimal(value, options);
}
export function parseNumberInput(input: string): string | null {
  const raw = input
    .trim()
    .replace(/^(Rp|IDR)\s*/i, "")
    .replace(/[\s\u00a0]/g, "");
  if (raw === "") return "";
  // A comma is the decimal separator. Dots are grouping separators.
  if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)?(?:,\d*)?$/.test(raw)) return null;
  return raw.replaceAll(".", "").replace(",", ".");
}
export function money(value: string | number, currency = "IDR") {
  const n = Number(value);
  return Number.isFinite(n)
    ? new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: /^[A-Z]{3}$/.test(currency) ? currency : "IDR",
        maximumFractionDigits: 6,
      }).format(n)
    : "—";
}
export const friendlyLabels: Record<string, string> = {
  prepaid: "Full payment before delivery",
  deposit_before: "Deposit, then balance before delivery",
  deposit_credit: "Deposit, then credit terms",
  credit: "Credit terms",
  order: "On order confirmation",
  dispatch: "On dispatch",
  receipt: "On customer receipt",
  payment_request: "Payment request / advance",
  supplier_request: "Supplier advance request",
  invoice: "Customer invoice",
  supplier_bill: "Supplier bill",
  credit_note: "Customer credit note",
  supplier_credit: "Supplier credit note",
};
export const fieldHelp: Record<string, string> = {
  billing_event:
    "Controls when an invoice can be created. Dispatch requires a posted delivery; customer receipt also requires a recorded receipt. Use a payment request for advances before shipment.",
  mode: "Payment approval and payment completion are separate. Prepaid and deposit-before require full payment before dispatch. Deposit-credit requires the deposit and an approved credit policy.",
  deposit_percent:
    "Percentage of the agreed sales order total, including tax and freight, required as an advance.",
  bank_reference:
    "Use the bank's actual transaction reference. A verified transaction cannot be recorded twice for the same account.",
  available:
    "Verified payment balance that has not yet been allocated to a document.",
  amount:
    "Use dots for thousands and a comma for decimals, for example 1.250.000,50. Values are saved without grouping.",
  quantity:
    "Use dots for thousands and a comma for decimals, for example 1.250,75. Check the unit before saving.",
  allocation:
    "Links verified funds to an issued document. Recording or verifying money alone does not settle that document.",
  post: "Posting applies this movement to stock. The server checks current stock, Quality and financial requirements again.",
  credit_note:
    "Reduces an issued invoice. It does not refund money automatically.",
};
const fieldLabels: Record<string, string> = {
  id_produk: "Product",
  no_lot: "Lot number",
  tgl_sampling: "Sampling date",
  tgl_uji: "Test date",
  hasil_detail: "Test results",
  failure_reason: "Failure explanation",
  spesifikasi: "Specifications",
  nilai_min: "Minimum",
  nilai_maks: "Maximum",
  parameter_uji: "Test parameter",
  nama_produk: "Product name",
  kode_produk: "Product code",
  tanggal_rilis: "Release date",
  tanggal_expired: "Expiry date",
  id_hasil: "Inspection",
  id_hasil_uji: "Inspection",
  id: "Record",
  order_id: "Sales order",
  purchase_id: "Purchase order",
  related_id: "Original document",
  delivery_id: "Delivery",
  payment_id: "Payment",
  document_id: "Billing document",
};
export const humanLabel = (s: string) =>
  fieldLabels[s] ||
  friendlyLabels[s] ||
  s.replaceAll("_", " ").replace(/^./, (x) => x.toUpperCase());
export type FieldError = { path: string; message: string };
export function validationFields(
  issues: readonly {
    path: readonly PropertyKey[];
    code: string;
    message: string;
    minimum?: unknown;
    maximum?: unknown;
    origin?: string;
    format?: string;
  }[],
): FieldError[] {
  return issues.map((i) => {
    let message = i.message;
    if (i.code === "too_small")
      message =
        i.origin === "string"
          ? i.minimum === 1
            ? "Complete this field."
            : `Enter at least ${i.minimum} characters.`
          : i.origin === "array"
            ? "Add at least one item."
            : `Enter a value of at least ${i.minimum}.`;
    else if (i.code === "too_big")
      message =
        i.origin === "string"
          ? `Use ${i.maximum} characters or fewer.`
          : i.origin === "array"
            ? `Use ${i.maximum} items or fewer.`
            : `Enter ${i.maximum} or less.`;
    else if (i.code === "invalid_type")
      message = "Enter or select a valid value.";
    else if (i.code === "invalid_value")
      message =
        i.path.at(-1) === "acknowledged"
          ? "Confirm that you reviewed the variance."
          : "Select one of the available options.";
    else if (i.code === "invalid_union")
      message = "Enter a valid value, or leave this optional field empty.";
    else if (i.code === "invalid_format" && i.format === "uuid")
      message = "Select a record.";
    else if (i.code === "invalid_format" && i.format === "date")
      message = "Enter a valid date.";
    else if (i.code === "invalid_format" && i.format === "email")
      message = "Enter a valid email address.";
    else if (i.code === "invalid_format" && i.format === "url")
      message = "Enter a valid HTTPS document link.";
    else if (i.code === "invalid_format" && i.path.at(-1) === "currency")
      message = "Use a three-letter currency code, such as IDR.";
    return { path: i.path.join("."), message };
  });
}
export function validationMessage(
  issues: Parameters<typeof validationFields>[0],
) {
  return validationFields(issues)
    .map((field) => `${humanLabel(field.path)}: ${field.message}`)
    .join(" ");
}
/** Six-place arithmetic avoids binary rounding and preserves high-value amounts. */
export function units(value: unknown): bigint {
  const s = String(value ?? "0");
  if (!/^\d+(\.\d{0,6})?$/.test(s)) return BigInt(0);
  const [a, b = ""] = s.split(".");
  return BigInt(a) * BigInt(1000000) + BigInt(b.padEnd(6, "0"));
}
export function decimalUnits(n: bigint): string {
  const v = n < BigInt(0) ? BigInt(0) : n;
  const fraction = String(v % BigInt(1000000))
    .padStart(6, "0")
    .replace(/0+$/, "");
  return String(v / BigInt(1000000)) + (fraction ? "." + fraction : "");
}
export function requestSuggestion(
  total: unknown,
  percent: unknown,
  requested: unknown,
  purpose: string,
): string {
  const gross = units(total),
    prior = units(requested);
  const target =
    purpose === "deposit"
      ? (gross * units(percent) + BigInt(50000000)) / BigInt(100000000)
      : gross;
  return decimalUnits(target > prior ? target - prior : BigInt(0));
}
export function allocationSuggestion(
  available: unknown,
  outstanding: unknown,
): string {
  const a = units(available),
    b = units(outstanding);
  return decimalUnits(a < b ? a : b);
}
