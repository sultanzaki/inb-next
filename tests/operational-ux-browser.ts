import { submitControl } from "./confirmation-browser";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import type { Page } from "playwright";
export async function exerciseOperationalUX(
  page: Page,
  db: Client,
  origin: string,
  capture: (s: string) => Promise<void>,
  accessible: () => Promise<void>,
) {
  const token = (await page.context().cookies(origin)).find(
    (c) => c.name === "session_token",
  )!.value;
  const actor = (
    await db.query("select user_id from sessions where token=$1", [token])
  ).rows[0].user_id;
  await db.query(
    "update erp_modules set state='active' where key in ('finance','sales','warehouse','production')",
  );
  const key = randomUUID(),
    party = (
      await db.query(
        "insert into erp_customers(name) values($1) returning id",
        ["UX Customer " + key],
      )
    ).rows[0].id;
  const q = (
    await db.query(
      "insert into erp_quotes(number,root_id,customer_id,date,valid_until,currency,state,lines,totals,created_by) values($1,$2,$3,erp_today(),erp_today()+30,'IDR','accepted','[]','{\"total\":\"60000000\"}',$4) returning id",
      ["Q-UX-" + key, key, party, actor],
    )
  ).rows[0].id;
  const order = (
    await db.query(
      "insert into erp_orders(number,quote_id,root_id,snapshot) values($1,$2,$3,$4) returning id",
      [
        "SO-UX-" + key,
        q,
        key,
        {
          customer: { name: "UX Customer " + key },
          currency: "IDR",
          totals: { total: "60000000", subtotal: "60000000" },
          lines: [],
        },
      ],
    )
  ).rows[0].id;
  await db.query(
    "insert into erp_fin_terms(order_id,mode,deposit_percent,billing_event,state,created_by) values($1,'deposit_credit',30,'dispatch','approved',$2)",
    [order, actor],
  );
  const top = () => page.locator("[role=dialog].erp-dialog").last();
  await page.goto(origin + "/dashboard/finance?view=orders&record=" + order);
  await page
    .getByRole("button", { name: "Request down payment", exact: true })
    .click();
  await top()
    .getByRole("button", { name: "Save billing draft", exact: true })
    .waitFor({ state: "visible" });
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("input")).some(
      (el) => el.value === "18.000.000",
    ),
  );
  assert.equal(
    await top().getByLabel("Amount", { exact: true }).inputValue(),
    "18.000.000",
  );
  await top()
    .getByRole("button", { name: "About amount", exact: false })
    .count();
  const amountInput = top().getByLabel("Amount", { exact: true });
  await amountInput.fill("");
  await amountInput.pressSequentially("1234567");
  assert.equal(
    await amountInput.inputValue(),
    "1.234.567",
    "group while typing without blur",
  );
  await amountInput.pressSequentially(",50");
  assert.equal(await amountInput.inputValue(), "1.234.567,50");
  await amountInput.evaluate((el) =>
    (el as HTMLInputElement).setSelectionRange(2, 2),
  );
  await amountInput.press("Backspace");
  assert.equal(
    await amountInput.inputValue(),
    "234.567,50",
    "backspace across grouping removes the digit",
  );
  await amountInput.fill("12.500");
  await amountInput.press("End");
  await amountInput.press(".");
  await amountInput.pressSequentially("25");
  assert.equal(
    await amountInput.inputValue(),
    "12.500,25",
    "decimal key accepts desktop numpad notation",
  );
  await top().getByLabel("Amount", { exact: true }).fill("1.5");
  await top().getByLabel("Document date", { exact: true }).click();
  await top().getByLabel("Amount", { exact: true }).focus();
  assert.equal(
    await top().getByLabel("Amount", { exact: true }).inputValue(),
    "1.5",
    "ambiguous input must not be reinterpreted on focus",
  );
  await top()
    .getByRole("button", { name: "Save billing draft", exact: true })
    .click();
  await top()
    .getByText(
      "Use dots for thousands and a comma for decimals, for example 1.250,50.",
      { exact: true },
    )
    .last()
    .waitFor();
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("name") === "amount",
  );
  await top().getByLabel("Amount", { exact: true }).fill("Rp 12.500.000,50");
  await top().getByLabel("Document date", { exact: true }).click();
  assert.equal(
    await top().getByLabel("Amount", { exact: true }).inputValue(),
    "12.500.000,5",
  );
  await top()
    .getByLabel("Payment request purpose", { exact: true })
    .selectOption("auto");
  assert.equal(
    await top().getByLabel("Amount", { exact: true }).inputValue(),
    "18.000.000",
  );
  await accessible();
  await capture("ux-dp-desktop");
  await top()
    .getByRole("button", { name: "Save billing draft", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll("[role=dialog]").length === 1,
  );
  const doc = (
    await db.query(
      "select id,amount from erp_fin_documents where order_id=$1 and kind='payment_request'",
      [order],
    )
  ).rows[0];
  assert.equal(Number(doc.amount), 18000000);
  await page.goto(
    origin + "/dashboard/finance?view=documents&record=" + doc.id,
  );
  await page
    .getByRole("button", { name: "Approve and issue", exact: true })
    .click();
  await top().getByLabel("Reason", { exact: true }).fill("a");
  await submitControl(top(), "Confirm");
  await top()
    .getByText("Enter at least 3 characters.", { exact: true })
    .last()
    .waitFor();
  assert.equal(
    await top()
      .getByLabel("Reason", { exact: true })
      .getAttribute("aria-invalid"),
    "true",
  );
  assert.equal(
    await top().getByLabel("Reason", { exact: true }).inputValue(),
    "a",
  );
  await top()
    .getByLabel("Reason", { exact: true })
    .fill("Reviewed down payment");
  await submitControl(top(), "Confirm");
  await page.waitForFunction(
    () => document.querySelectorAll("[role=dialog]").length === 1,
  );
  // Existing advance is recognized; a second automatic DP is not suggested.
  await page.goto(origin + "/dashboard/finance?view=orders&record=" + order);
  await page
    .getByRole("button", { name: "Request down payment", exact: true })
    .click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("input")).some(
      (el) => el.value === "0",
    ),
  );
  assert.equal(
    await top().getByLabel("Amount", { exact: true }).inputValue(),
    "0",
  );
  await top()
    .getByLabel("Payment request purpose", { exact: true })
    .selectOption("balance");
  assert.equal(
    await top().getByLabel("Amount", { exact: true }).inputValue(),
    "42.000.000",
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await top()
    .getByRole("button", { name: "About Amount", exact: true })
    .click();
  await page
    .getByText(
      "Use dots for thousands and a comma for decimals, for example 1.250.000,50. Values are saved without grouping.",
      { exact: true },
    )
    .waitFor();
  const overflowing = await top().evaluate((dialog) =>
    [
      dialog as HTMLElement,
      ...Array.from(
        dialog.querySelectorAll<HTMLElement>(
          ".erp-form,.erp-form-body,.erp-field",
        ),
      ),
    ]
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollLeft > 0)
      .map((el) => ({
        class: el.className,
        width: el.clientWidth,
        scroll: el.scrollWidth,
        left: el.scrollLeft,
      })),
  );
  assert.deepEqual(overflowing, []);
  await accessible();
  await capture("ux-dp-mobile");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.keyboard.press("Escape");
  await page.goto(
    origin + "/dashboard/finance?view=documents&record=" + doc.id,
  );
  // Start from the issued request: record funds, verify, then allocate without
  // returning to a list or memorizing a newly created payment number.
  await page
    .getByRole("button", { name: "Record actual payment", exact: true })
    .click();
  await top().getByLabel("Payment amount", { exact: true }).fill("2.000.000");
  await top()
    .getByLabel("Bank / cash account reference", { exact: true })
    .fill("UX bank " + key);
  await top()
    .getByLabel("Bank transaction reference", { exact: true })
    .fill(key + "-manual");
  await top()
    .getByLabel("Verified funds / bank evidence reference", { exact: true })
    .fill("Bank statement evidence");
  await top().getByRole("button", { name: "Save", exact: true }).click();
  await page.mouse.move(0, 0);
  await page
    .locator('[data-sonner-toast][data-removed="false"]')
    .last()
    .waitFor({ state: "hidden", timeout: 10000 });
  await page
    .getByRole("button", { name: "Verify actual funds", exact: true })
    .click();
  await top()
    .getByLabel("Reason", { exact: true })
    .fill("Verified against bank statement");
  await submitControl(top(), "Confirm");
  await page
    .getByRole("button", { name: "Allocate payment", exact: true })
    .click();
  await top()
    .getByRole("button", { name: "Issued document", exact: true })
    .click();
  const number = (
    await db.query("select number from erp_fin_documents where id=$1", [doc.id])
  ).rows[0].number;
  await page
    .getByRole("textbox", { name: "Search Issued document", exact: true })
    .fill(number);
  await page
    .locator(".erp-picker-results button")
    .filter({ hasText: number })
    .click();
  assert.equal(
    await top().getByLabel("Allocation amount", { exact: true }).inputValue(),
    "2.000.000",
  );
  await top()
    .getByLabel("Reason / completion evidence", { exact: true })
    .fill("Allocate verified funds to advance");
  await top().getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll("[role=dialog]").length === 1,
  );
  await page.goto(
    origin + "/dashboard/finance?view=documents&record=" + doc.id,
  );
  const pay = (
    await db.query(
      "insert into erp_fin_payments(number,direction,party_type,party_id,currency,amount,date,bank_account,bank_reference,evidence,state,created_by) values($1,'receipt','customer',$2,'IDR',10000000,erp_today(),'UX account',$3,'Statement verified','verified',$4) returning id",
      ["PAY-UX-" + key, party, key, actor],
    )
  ).rows[0].id;
  await page
    .getByRole("button", { name: "Allocate payment", exact: true })
    .click();
  await top()
    .getByRole("button", { name: "Verified payment", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search Verified payment", exact: true })
    .fill(key);
  await page
    .locator(".erp-picker-results button")
    .filter({ hasText: "PAY-UX-" + key })
    .click();
  assert.equal(
    await top().getByLabel("Allocation amount", { exact: true }).inputValue(),
    "10.000.000",
  );
  await top()
    .getByLabel("Reason / completion evidence", { exact: true })
    .fill("Allocate partial deposit");
  await top().getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll("[role=dialog]").length === 1,
  );
  const allocated = (
    await db.query(
      "select sum(amount) a from erp_fin_allocations where payment_id=$1 and state='active'",
      [pay],
    )
  ).rows[0].a;
  assert.equal(Number(allocated), 10000000);
  await page.setViewportSize({ width: 1440, height: 1000 });
}
