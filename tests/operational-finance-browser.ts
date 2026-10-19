import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import type { Client } from "pg";
export async function exerciseOperationalFinance(
  page: Page,
  db: Client,
  origin: string,
  suffix: string,
  capture: (name: string) => Promise<void>,
  accessible: () => Promise<void>,
) {
  const top = () => page.getByRole("dialog").last();
  async function post(action: string, data: unknown) {
    const r = await page.request.post(origin + "/api/erp/" + action, {
      data,
      headers: { origin },
    });
    assert.equal(r.status(), 200, await r.text());
    return r.json();
  }
  async function pick(label: string, q: string) {
    await top().getByRole("button", { name: label, exact: true }).click();
    await page
      .getByRole("textbox", { name: "Search " + label, exact: true })
      .fill(q);
    await page
      .locator(".erp-picker-results button")
      .filter({ hasText: q })
      .first()
      .click();
  }
  await db.query(
    "update erp_modules set state='active' where key in ('service','finance','sales')",
  );
  const token = (await page.context().cookies(origin)).find(
    (c) => c.name === "session_token",
  )!.value;
  const actor = (
    await db.query("select user_id from sessions where token=$1", [token])
  ).rows[0].user_id;
  const customer = (
    await db.query("insert into erp_customers(name) values($1) returning id", [
      "Finance " + suffix,
    ])
  ).rows[0].id;
  const root = randomUUID(),
    today = (await db.query("select erp_today()::text d")).rows[0].d;
  const quote = (
    await db.query(
      "insert into erp_quotes(number,root_id,customer_id,date,valid_until,currency,state,lines,totals,created_by) values($1,$2,$3,erp_today(),erp_today()+30,'IDR','accepted','[]',$4,$5) returning id",
      [
        "Q-FIN-" + suffix,
        root,
        customer,
        { subtotal: "100", total: "100", tax: "0", freight: "0" },
        actor,
      ],
    )
  ).rows[0].id;
  const so = "SO-FIN-" + suffix;
  const order = (
    await db.query(
      "insert into erp_orders(number,quote_id,root_id,snapshot) values($1,$2,$3,$4) returning id",
      [
        so,
        quote,
        root,
        {
          customer: { name: "Finance " + suffix },
          currency: "IDR",
          totals: { subtotal: "100", tax: "0", freight: "0", total: "100" },
          lines: [],
        },
      ],
    )
  ).rows[0].id;
  await page.goto(origin + "/dashboard/finance?view=orders&q=" + so);
  await page.getByRole("button", { name: so, exact: true }).click();
  await page
    .getByRole("button", { name: "Configure payment terms", exact: true })
    .click();
  await top()
    .getByLabel("Invoice trigger", { exact: true })
    .selectOption("order");
  await top().getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll("[role=dialog]").length === 1,
  );
  await page
    .getByRole("button", { name: "Approve payment terms", exact: true })
    .click();
  await top().getByLabel("Reason").fill("Agreement and credit reviewed");
  await top().getByRole("button", { name: "Confirm", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll("[role=dialog]").length === 1,
  );
  await page.goto(origin + "/dashboard/finance");
  await page
    .getByRole("button", { name: "New billing document", exact: true })
    .click();
  await top()
    .getByLabel("Document type", { exact: true })
    .selectOption("payment_request");
  await pick("Source order", so);
  await top().getByLabel("Amount", { exact: true }).fill("100");
  await top()
    .getByRole("button", { name: "Save billing draft", exact: true })
    .click();
  await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
  const doc = (
    await db.query(
      "select id,number from erp_fin_documents where order_id=$1",
      [order],
    )
  ).rows[0];
  await page.getByRole("button", { name: doc.number, exact: true }).click();
  await page
    .getByRole("button", { name: "Approve and issue", exact: true })
    .click();
  await top().getByLabel("Reason").fill("Advance request approved");
  await top().getByRole("button", { name: "Confirm", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll("[role=dialog]").length === 1,
  );
  const pdf = await page.request.get(
    origin + "/api/erp/documents/fin_documents/" + doc.id,
  );
  assert.equal(pdf.status(), 200);
  assert.ok((await pdf.body()).subarray(0, 5).toString() === "%PDF-");
  const pay = await post("fin_record_payment", {
    request_key: randomUUID(),
    direction: "receipt",
    party_type: "customer",
    party_id: customer,
    currency: "IDR",
    amount: "100",
    date: today,
    bank_account: "Bank fixture",
    bank_reference: randomUUID(),
    evidence: "Statement verified",
    notes: "",
  });
  await post("fin_verify_payment", {
    id: pay.id,
    version: 1,
    reason: "Bank receipt checked",
  });
  await post("fin_allocate", {
    request_key: randomUUID(),
    payment_id: pay.id,
    document_id: doc.id,
    amount: "100",
    reason: "Advance matched to order",
  });
  await page.goto(origin + "/dashboard/service");
  await page.getByRole("button", { name: "New case", exact: true }).click();
  await top()
    .getByLabel("Case type", { exact: true })
    .selectOption("change_request");
  await pick("Source record", so);
  await top()
    .getByLabel("Title", { exact: true })
    .fill("Change delivery schedule " + suffix);
  await top()
    .getByLabel("Description", { exact: true })
    .fill("Customer requested a revised delivery schedule.");
  await top().getByRole("button", { name: "Create case", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
  await page
    .getByRole("button", { name: /CASE-/, exact: false })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Change status", exact: true })
    .click();
  await top()
    .getByLabel("Reason / completion evidence", { exact: true })
    .fill("Evidence ready for review");
  await top().getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll("[role=dialog]").length === 1,
  );
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await accessible();
    await capture("operational-case-" + width);
  }
  await page.goto(origin + "/dashboard/finance?view=payments");
  await page
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await top()
    .getByLabel("Party type", { exact: true })
    .selectOption("supplier");
  assert.equal(
    await top().getByLabel("Payment direction", { exact: true }).inputValue(),
    "payment",
  );
  await accessible();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await capture("finance-mobile-payment");
  await page.goto(origin + "/dashboard/finance");
  const csv = await page.request.get(origin + "/api/erp/export/fin_documents");
  assert.equal(csv.status(), 200);
  assert.match(await csv.text(), new RegExp(doc.number));
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Subsequent legacy checks use their original module configuration.
  await db.query(
    "update erp_modules set state='disabled' where key in ('finance','service')",
  );
}
