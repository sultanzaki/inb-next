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

test("protected reads overlap authentication but never release data before authorization", async () => {
  const { authorizedRead } = await import("../src/lib/authorized-read");
  let authorize!: (value: { id: string } | null) => void;
  let readStarted = false,
    completed = false;
  const session = new Promise<{ id: string } | null>((resolve) => {
    authorize = resolve;
  });
  const result = authorizedRead(
    () => session,
    async () => {
      readStarted = true;
      return Response.json({ secret: "record" });
    },
  ).then((response) => {
    completed = true;
    return response;
  });
  assert.equal(
    readStarted,
    true,
    "Read starts without waiting for network authentication",
  );
  await Promise.resolve();
  assert.equal(completed, false);
  authorize({ id: "allowed" });
  const allowed = await result;
  assert.deepEqual(await allowed.json(), { secret: "record" });
  assert.match(
    allowed.headers.get("Server-Timing")!,
    /session;dur=.*read;dur=.*total;dur=/,
  );
  const denied = await authorizedRead(
    async () => null,
    async () => Response.json({ secret: "hidden" }),
  );
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { message: "Session expired." });
  const deniedFailure = await authorizedRead(
    async () => null,
    async () => {
      throw Error("private query failure");
    },
  );
  assert.equal(deniedFailure.status, 401);
});

test("concurrent ERP reads share a request, isolate cancellation and never cache settled data", async () => {
  const { readERPPage, invalidateERPReads } =
    await import("../src/lib/erp/read-request");
  const original = globalThis.fetch;
  let calls = 0,
    resolve!: (value: Response) => void;
  const signals: AbortSignal[] = [];
  globalThis.fetch = (async (_url, options) => {
    calls++;
    signals.push(options!.signal as AbortSignal);
    return new Promise<Response>((done) => {
      resolve = done;
    });
  }) as typeof fetch;
  try {
    const one = new AbortController(),
      two = new AbortController();
    const a = readERPPage("/test/shared", one.signal);
    const b = readERPPage("/test/shared", two.signal);
    assert.equal(calls, 1);
    const canceled = assert.rejects(a, { name: "AbortError" });
    one.abort();
    await canceled;
    assert.equal(
      signals[0].aborted,
      false,
      "One subscriber cannot cancel another reader",
    );
    resolve(Response.json({ rows: [], total: 0 }));
    await b;
    const c = readERPPage("/test/shared", new AbortController().signal);
    assert.equal(
      calls,
      2,
      "Completed records are not reused as stale financial data",
    );
    resolve(Response.json({ rows: [], total: 1 }));
    assert.equal((await c).total, 1);
    const d = readERPPage("/test/after-write", new AbortController().signal);
    const firstResolve = resolve;
    invalidateERPReads();
    const e = readERPPage("/test/after-write", new AbortController().signal);
    assert.equal(
      calls,
      4,
      "Mutation invalidation prevents joining a pre-write read",
    );
    firstResolve(Response.json({ rows: [], total: 1 }));
    resolve(Response.json({ rows: [], total: 2 }));
    assert.equal((await d).total, 1);
    assert.equal((await e).total, 2);
    const last = new AbortController();
    const abandoned = readERPPage("/test/abandoned", last.signal);
    const abandonedRejection = assert.rejects(abandoned, {
      name: "AbortError",
    });
    last.abort();
    await abandonedRejection;
    assert.equal(signals.at(-1)!.aborted, true);
    resolve(Response.json({ rows: [], total: 0 }));
    await Promise.resolve();
  } finally {
    globalThis.fetch = original;
    invalidateERPReads();
  }
});
