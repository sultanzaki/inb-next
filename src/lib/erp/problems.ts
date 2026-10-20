import type { FieldError } from "./ux";
export function erpProblem(error: { code?: string; message?: string }): {
  message?: string;
  fields: FieldError[];
} {
  const raw = error.message || "";
  if (error.code === "23505" && raw.includes("erp_fin_bank_ref"))
    return {
      message:
        "A verified payment already uses this bank account and transaction reference. Review the existing payment; do not record the same transfer twice.",
      fields: [
        {
          path: "bank_reference",
          message: "Already used by a verified payment for this account.",
        },
      ],
    };
  const rules: [RegExp, string, string][] = [
    [
      /Choose a posted delivery/,
      "delivery_id",
      "Select a posted delivery for this sales order. For an advance before shipment, create a payment request instead.",
    ],
    [
      /Approve the order payment terms/,
      "order_id",
      "Open this sales order in Finance and approve its payment terms before billing.",
    ],
    [
      /Payment requests exceed/,
      "amount",
      "This amount exceeds the order total after existing payment requests. Review the linked requests.",
    ],
    [
      /Invoice quantity exceeds/,
      "lines",
      "Use the remaining unbilled quantity for the selected order or delivery.",
    ],
    [
      /Choose a verified payment/,
      "payment_id",
      "Select verified funds for the same customer or supplier and currency as the issued document.",
    ],
    [
      /Record customer receipt before/,
      "delivery_id",
      "Record customer receipt for this delivery before creating the invoice.",
    ],
  ];
  if (error.code === "P0001")
    for (const [pattern, path, message] of rules)
      if (pattern.test(raw)) return { message, fields: [{ path, message }] };
  return { fields: [] };
}
