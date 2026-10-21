import { requestTimeout } from "../src/lib/request-timeout";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseNumberInput,
  displayNumber,
  requestSuggestion,
  allocationSuggestion,
  validationFields,
} from "../src/lib/erp/ux";
import { actionSchemas } from "../src/lib/erp/schema";
test("Indonesian numeric input parses grouping and decimals without float conversion", () => {
  for (const [input, expected] of [
    ["Rp 60.000.000", "60000000"],
    ["1.250,75", "1250.75"],
    ["0,000001", "0.000001"],
    ["1.500", "1500"],
    ["", ""],
    ["999.999.999.999.999,123456", "999999999999999.123456"],
  ])
    assert.equal(parseNumberInput(input), expected);
  for (const input of ["1.5", "1,000,000", "1e6", "1.2.3", "Infinity", "abc"])
    assert.equal(parseNumberInput(input), null);
  assert.equal(displayNumber("1250.750000"), "1.250,750000");
  assert.equal(displayNumber("0.000001"), "0,000001");
});
test("DP suggestions subtract existing requests rather than requesting paid funds twice", () => {
  assert.equal(requestSuggestion("60000000", "30", "0", "deposit"), "18000000");
  assert.equal(requestSuggestion("60000000", "30", "18000000", "deposit"), "0");
  assert.equal(
    requestSuggestion("60000000", "30", "18000000", "balance"),
    "42000000",
  );
  assert.equal(
    requestSuggestion("60000000", "30", "10000000", "deposit"),
    "8000000",
  );
  assert.equal(requestSuggestion("0.000001", "50", "0", "deposit"), "0.000001");
  assert.equal(
    requestSuggestion("999999999999999.123456", "100", "0", "deposit"),
    "999999999999999.123456",
  );
});
test("Allocation never suggests more than available funds or outstanding balance", () => {
  assert.equal(allocationSuggestion("25000000", "18000000"), "18000000");
  assert.equal(allocationSuggestion("10000000", "18000000"), "10000000");
  assert.equal(allocationSuggestion("0", "18000000"), "0");
});
test("Validation issues preserve nested field paths and explain input requirements", () => {
  const result = actionSchemas.fin_verify_payment.safeParse({
    id: "bad",
    version: 1,
    reason: "a",
  });
  assert.equal(result.success, false);
  if (result.success) return;
  const fields = validationFields(result.error.issues);
  assert.ok(
    fields.some(
      (f) =>
        f.path === "reason" && f.message === "Enter at least 3 characters.",
    ),
  );
  assert.ok(
    fields.some((f) => f.path === "id" && f.message === "Select a record."),
  );
  assert.deepEqual(
    validationFields([
      {
        path: ["lines", 2, "quantity"],
        code: "invalid_type",
        message: "technical",
      },
    ]),
    [{ path: "lines.2.quantity", message: "Enter or select a valid value." }],
  );
});

test("Billing validation names missing sources, zero amounts and missing invoice lines", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const base = { request_key: id, date: "2026-10-20", due_date: "2026-10-20" };
  const cases = [
    [{ ...base, kind: "payment_request", amount: "0" }, ["order_id", "amount"]],
    [{ ...base, kind: "invoice", order_id: id, lines: [] }, ["lines"]],
    [{ ...base, kind: "supplier_bill", lines: [] }, ["purchase_id", "lines"]],
    [{ ...base, kind: "credit_note", amount: "10" }, ["related_id"]],
  ] as const;
  for (const [payload, paths] of cases) {
    const r = actionSchemas.fin_create_document.safeParse(payload);
    assert.equal(r.success, false);
    if (!r.success)
      for (const path of paths)
        assert.ok(r.error.issues.some((i) => i.path.join(".") === path));
  }
});

test("request timeout preserves caller cancellation and never aborts the parent signal", async () => {
  const parent = new AbortController();
  const timed = requestTimeout(parent.signal, 1);
  await new Promise<void>((resolve) =>
    timed.signal.addEventListener("abort", () => resolve(), { once: true }),
  );
  assert.equal(timed.signal.reason.name, "TimeoutError");
  assert.equal(parent.signal.aborted, false);
  timed.dispose();
  const canceled = requestTimeout(parent.signal, 10000);
  parent.abort();
  assert.equal(canceled.signal.aborted, true);
  canceled.dispose();
  const alreadyCanceled = requestTimeout(parent.signal);
  assert.equal(alreadyCanceled.signal.aborted, true);
  alreadyCanceled.dispose();
});
