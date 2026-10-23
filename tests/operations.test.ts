import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import {
  workCollections,
  workCommands,
  workHref,
} from "../src/lib/operations/catalog";
import { commandPayload } from "../src/lib/operations/validation";
import { renderOperationDocument } from "../src/lib/operations/pdf";
test("every workspace command and route resolves; canonical numbers never accept localized transport", () => {
  for (const [entity, definition] of Object.entries(workCollections)) {
    assert.match(workHref(entity), /^\/dashboard\//, entity);
    for (const command of [
      definition.create,
      ...(definition.actions || []),
    ].filter(Boolean))
      assert.ok(workCommands[command!], command);
  }
  const data = {
    request_key: randomUUID(),
    id: randomUUID(),
    version: 1,
    reservation_id: randomUUID(),
    quantity: "1200.5",
    reason: "Actual weighed use",
  };
  assert.equal(commandPayload("consume_material", data).quantity, "1200.5");
  assert.throws(() =>
    commandPayload("consume_material", { ...data, quantity: "1.200,5" }),
  );
  assert.throws(() =>
    commandPayload("consume_material", { ...data, quantity: "1,200.5" }),
  );
  assert.throws(() =>
    commandPayload("repack_pallet", {
      ...data,
      content_id: randomUUID(),
      destination_pallet: randomUUID(),
    }),
  );
});
test("formal work documents paginate long identities and results without remote assets", async () => {
  const record = {
    id: randomUUID(),
    number: "MO-2026-00001",
    state: "closed",
    version: 7,
    product: "STEARATE 800",
    unit: "kg",
    target_quantity: "100",
    actual_quantity: "100",
    scrap_quantity: "0",
    yield_percent: "100",
    formula_snapshot: {
      number: "BOM-001",
      revision: 1,
      requirements: [
        {
          material: "Stearic acid",
          required_quantity: "100",
          unit: "kg",
          tolerance_percent: "0",
        },
      ],
    },
    inputs: Array.from({ length: 100 }, (_, i) => ({
      material: "Stearic acid",
      lot: "LOT-" + i + "-".repeat(150),
      quantity: "1.000000",
      unit: "kg",
      kind: "consume",
      operator: "Warehouse operator",
      location: "Main storage",
    })),
    outputs: [],
  };
  const pdf = await PDFDocument.load(
    await renderOperationDocument(record, "batch"),
  );
  assert.match(pdf.getTitle() || "", /BATCH MANUFACTURING RECORD/);
  assert.ok(pdf.getPageCount() > 2);
  for (const kind of ["materials", "incoming", "transfer"]) {
    const doc = await PDFDocument.load(
      await renderOperationDocument({ ...record, state: "draft" }, kind),
    );
    assert.ok(doc.getPageCount() >= 1);
  }
});

test("navigation preserves every destination and selects only the current tab", async () => {
  const { navigationSections, workspaceLinkActive } =
    await import("../src/lib/workspace/navigation");
  const links = [
    "Stock",
    "Stock counts",
    "Pallet tracking",
    "Warehouse transfers",
    "Stock ledger",
    "Warehouses",
    "Storage locations",
  ].map((name, i) => [name, "/" + i]);
  const sections = navigationSections("Warehouse", links);
  assert.equal(sections.length, 4);
  assert.deepEqual(sections.flatMap((s) => s.links).sort(), [...links].sort());
  assert.equal(
    workspaceLinkActive("/dashboard/finance", "/dashboard/finance", "payments"),
    false,
  );
  assert.equal(
    workspaceLinkActive(
      "/dashboard/finance?view=payments",
      "/dashboard/finance",
      "payments",
    ),
    true,
  );
  assert.equal(
    workspaceLinkActive(
      "/dashboard/sales?view=quotes",
      "/dashboard/sales",
      null,
    ),
    true,
  );
  assert.equal(
    workspaceLinkActive("/dashboard", "/dashboard/finance", null),
    false,
  );
});
test("internal approval stamps require actual matching audit evidence and never attest drafts", async () => {
  const { approvalFromEvents, approvalLines, approvalActions } =
    await import("../src/lib/pdf/approval");
  assert.deepEqual(approvalActions("purchases", "partial"), [
    "confirm_purchase",
  ]);
  assert.ok(
    approvalActions("warehouse_transfers", "partial").includes(
      "dispatch_warehouse_transfer",
    ),
  );
  const id = randomUUID();
  const evidence = {
    id: "251",
    record_id: id,
    entity: "incoming_inspections",
    action: "finalize_incoming_inspection",
    actor: "Quality Officer",
    actor_id: randomUUID(),
    created_at: "2026-10-23T06:00:00Z",
  };
  assert.equal(
    approvalFromEvents("incoming_inspections", id, "draft", [evidence]),
    null,
  );
  assert.equal(
    approvalFromEvents("incoming_inspections", randomUUID(), "pass", [
      evidence,
    ]),
    null,
  );
  assert.equal(
    approvalFromEvents("incoming_inspections", id, "pass", [
      { ...evidence, action: "save_incoming_results" },
    ]),
    null,
  );
  assert.equal(
    approvalFromEvents("incoming_inspections", id, "pass", [
      { ...evidence, created_at: "invalid" },
    ]),
    null,
  );
  assert.equal(
    approvalFromEvents("incoming_inspections", id, "pass", []),
    null,
  );
  const stamp = approvalFromEvents("incoming_inspections", id, "fail", [
    evidence,
  ])!;
  assert.equal(stamp.name, "Quality Officer");
  assert.equal(stamp.eventId, "WORK-251");
  assert.match(
    approvalLines(stamp).find(([key]) => key === "Recorded at")![1],
    /13:00:00 WIB$/,
  );
  const pdf = await renderOperationDocument(
    { id, number: "IN-251", state: "fail", results: [] },
    "incoming",
    stamp,
  );
  const doc = await PDFDocument.load(pdf);
  assert.ok(doc.getPageCount() > 0);
});
