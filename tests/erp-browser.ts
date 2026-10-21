import { submitControl } from "./confirmation-browser";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { Client } from "pg";
export async function exerciseERP(
  page: Page,
  db: Client,
  origin: string,
  suffix: string,
  capture: (s: string) => Promise<void>,
  accessible: () => Promise<void>,
) {
  const token = (await page.context().cookies()).find(
    (c) => c.name === "session_token",
  )!.value;
  const qc = async (action: string, payload: unknown) =>
    (
      await db.query("select qc_mutate($1,$2,$3) r", [
        token,
        action,
        JSON.stringify(payload),
      ])
    ).rows[0].r;
  async function post(action: string, payload: unknown) {
    const r = await page.request.post(origin + "/api/erp/" + action, {
      data: payload,
    });
    const data = await r.json();
    assert.equal(r.status(), 200, JSON.stringify(data));
    return data;
  }
  async function pick(label: string, q: string) {
    await page.getByRole("button", { name: label, exact: true }).last().click();
    await page
      .getByRole("textbox", { name: "Search " + label, exact: true })
      .fill(q);
    await page
      .locator(".erp-picker-results button")
      .filter({ hasText: q })
      .first()
      .click();
  }
  const top = () => page.getByRole("dialog").last();
  async function close() {
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
  }
  async function action(name: string, reason?: string) {
    await page.getByRole("button", { name, exact: true }).click();
    if (reason) await top().getByLabel("Reason", { exact: true }).fill(reason);
    await submitControl(top(), "Confirm");
  }
  async function status(state: string) {
    await page.getByText("Status: " + state, { exact: true }).waitFor();
  }
  const today = (await db.query("select erp_today()::text d")).rows[0].d,
    expiry = (
      await db.query("select (erp_today()+interval '1 year')::date::text d")
    ).rows[0].d;
  const code = "ERP-BROWSER-" + suffix,
    name = "ERP magnesium stearate " + suffix,
    series = "00" + String(parseInt(suffix, 16)),
    lotNumber =
      series +
      ".01." +
      today.split("-").reverse().join("") +
      "." +
      expiry.slice(0, 4);
  const product = (
    await qc("create_produk", {
      kode_produk: code,
      nama_produk: name,
      kategori: "Chemical",
      satuan: "kg",
      status_halal: "Halal",
      tipe_kemasan: "Bag",
      spesifikasi: [
        {
          parameter_uji: "pH",
          tipe_batas: "RANGE",
          nilai_min: "6",
          nilai_maks: "8",
          satuan: "",
          keterangan: "",
        },
      ],
    })
  ).id;
  await post("set_module", { module: "production", state: "active" });
  await post("set_series", { product_id: product, series });
  // Manual settings are real UI operations; no warehouse balances are seeded.
  await page.goto(origin + "/dashboard/admin/settings");
  await page.getByRole("button", { name: "Locations", exact: true }).click();
  await page.getByRole("button", { name: "Add location", exact: true }).click();
  await top()
    .getByLabel("Code", { exact: true })
    .fill("ERP-" + suffix);
  await top()
    .getByLabel("Name", { exact: true })
    .fill("ERP test zone " + suffix);
  const savedLocation = page.waitForResponse(
    (r) =>
      r.url().includes("/api/erp/save_location") &&
      r.request().method() === "POST",
  );
  await top().getByRole("button", { name: "Save", exact: true }).click();
  const locationResponse = await savedLocation;
  assert.equal(locationResponse.status(), 200, await locationResponse.text());
  await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
  const location = (
    await db.query("select id from erp_locations where code=$1", [
      "ERP-" + suffix,
    ])
  ).rows[0].id;
  await page.goto(origin + "/dashboard/production");
  await page
    .getByRole("button", { name: "Record production", exact: true })
    .click();
  await pick("Destination location", "ERP-" + suffix);
  await pick("Product", code);
  await top().getByLabel("Quantity", { exact: true }).fill("100");
  assert.equal(
    await top().getByLabel("Lot / batch number", { exact: true }).count(),
    0,
  );
  await top()
    .getByLabel("Reference / reason", { exact: true })
    .fill("Finished output QA");
  await capture("40-erp-production-form");
  await accessible();
  await top().getByRole("button", { name: "Save draft", exact: true }).click();
  await status("draft");
  await action("Post movement");
  await status("posted");
  await close();
  const lot = (
    await db.query(
      "select id,qc_status from erp_lots where product_id=$1 and number=$2",
      [product, lotNumber],
    )
  ).rows[0];
  assert.equal(lot.qc_status, "quarantine");
  assert.equal(
    (
      await db.query(
        "select quantity::text q from erp_balances where lot_id=$1",
        [lot.id],
      )
    ).rows[0].q,
    "100.000000",
  );
  // The existing QC browser flow is tested separately. Here its real evaluator releases this stocked lot.
  const spec = (
    await db.query("select id from spesifikasi where id_produk=$1", [product])
  ).rows[0].id;
  const inspection = await qc("create_uji", {
    id_produk: product,
    no_lot: lotNumber,
    tgl_sampling: today,
    tgl_uji: today,
    inspector: "ERP browser QA",
    catatan: "Batch release",
    failure_reason: "",
    status: "PASS",
    hasil_detail: [{ spec_id: spec, p: "pH", val: "7", st: "PASS" }],
  });
  await qc("issue_coa", {
    id_hasil: inspection.id,
    no_coa: "",
    tanggal_rilis: today,
    tanggal_expired: expiry,
    mfg_date: today,
    tanda_tangan: "ERP QA",
    language: "en",
  });
  await page.goto(origin + "/dashboard/sales");
  await page.getByRole("button", { name: "Customers", exact: true }).click();
  await page.getByRole("button", { name: "New customer", exact: true }).click();
  await top()
    .getByLabel("Company name", { exact: true })
    .fill("ERP customer " + suffix);
  await top()
    .getByLabel("Billing address", { exact: true })
    .fill("Frozen billing address");
  await top()
    .getByLabel("Shipping address", { exact: true })
    .fill("Warehouse destination");
  await top().getByRole("button", { name: "Save", exact: true }).click();
  try {
    await page
      .getByRole("heading", { name: "ERP customer " + suffix, exact: true })
      .waitFor();
  } catch (error) {
    await capture("40-customer-save-diagnostic");
    assert.fail(
      "Customer save failed: " +
        (await page.getByRole("dialog").last().innerText()) +
        " " +
        String(error),
    );
  }
  await close();
  await page.getByRole("button", { name: "Quotations", exact: true }).click();
  await page
    .getByRole("button", { name: "New quotation", exact: true })
    .click();
  await pick("Customer", "ERP customer " + suffix);
  await pick("Product", code);
  await top().getByLabel("Quantity", { exact: true }).fill("20");
  await top().getByLabel("Unit price", { exact: true }).fill("1500");
  await top().getByLabel("Tax %", { exact: true }).fill("11");
  await top()
    .getByLabel("Payment & commercial terms", { exact: true })
    .fill("Net 30 days");
  await capture("41-erp-quotation-form");
  await accessible();
  await top()
    .getByRole("button", { name: "Save quotation draft", exact: true })
    .click();
  await status("draft");
  const quote = (
    await db.query(
      "select id,number from erp_quotes where lines @> $1::jsonb order by created_at desc limit 1",
      [JSON.stringify([{ product_id: product }])],
    )
  ).rows[0];
  const preview = await page.request.get(
    origin + "/api/erp/documents/quotes/" + quote.id,
  );
  assert.equal(preview.status(), 200);
  assert.match(preview.headers()["content-type"], /application\/pdf/);
  assert.equal((await preview.body()).subarray(0, 4).toString(), "%PDF");
  await page.getByRole("button", { name: "Preview PDF", exact: true }).click();
  await page.getByTitle("Document PDF preview").waitFor();
  await page.keyboard.press("Escape");
  await action("Issue / request approval");
  await status("issued");
  await action("Mark accepted");
  await status("accepted");
  for (const viewport of [
    { width: 320, height: 500 },
    { width: 375, height: 650 },
    { width: 1440, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    const conversion = top().getByRole("region", {
      name: "Sales order conversion",
    });
    await conversion.waitFor();
    assert.equal(
      await top().evaluate((el) => getComputedStyle(el).overflowY),
      "auto",
      "inline conversion must not disable scrolling of record details",
    );
    const submit = conversion.getByRole("button", {
      name: "Create sales order",
      exact: true,
    });
    await submit.scrollIntoViewIfNeeded();
    assert.ok(
      await submit.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
        );
      }),
      "sales order action stays reachable on short screens",
    );
    await capture("42-accepted-quotation-" + viewport.width);
    await accessible();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await top()
    .getByLabel("Customer reference (optional)", { exact: true })
    .fill("Customer ref " + suffix);
  await top()
    .getByRole("button", { name: "Create sales order", exact: true })
    .click();
  await status("confirmed");
  const order = (
    await db.query("select id,number from erp_orders where quote_id=$1", [
      quote.id,
    ])
  ).rows[0];
  // A previous browser scenario may leave Finance enabled. Honor its real
  // dispatch gate instead of relying on an implicit disabled-module fixture.
  if (
    (await db.query("select state from erp_modules where key='finance'"))
      .rows[0]?.state === "active"
  ) {
    const customer = (
      await db.query("select customer_id from erp_quotes where id=$1", [
        quote.id,
      ])
    ).rows[0].customer_id;
    await post("fin_terms", {
      request_key: randomUUID(),
      order_id: order.id,
      mode: "credit",
      deposit_percent: "0",
      due_days: 30,
      billing_event: "dispatch",
    });
    await post("fin_approve_terms", {
      id: order.id,
      version: 1,
      reason: "Browser fixture approved credit terms",
    });
    await post("fin_credit_policy", {
      customer_id: customer,
      currency: "IDR",
      credit_limit: "1000000",
      on_hold: false,
      hold_overdue: true,
      reason: "Browser fixture credit approved",
    });
  }
  await close();
  await page.goto(
    origin +
      "/dashboard/sales?view=quotes&q=" +
      encodeURIComponent(quote.number),
  );
  await page.getByRole("button", { name: quote.number, exact: true }).click();
  await top()
    .getByRole("button", { name: "Open sales order", exact: true })
    .waitFor();
  assert.equal(
    await top()
      .getByRole("button", { name: "Create sales order", exact: true })
      .count(),
    0,
  );
  const quoteDetail = await (
    await page.request.get(origin + "/api/erp/quotes?id=" + quote.id)
  ).json();
  assert.equal(quoteDetail.rows[0].sales_order.id, order.id);
  await capture("43-quotation-existing-order");
  await top()
    .getByRole("button", { name: "Open sales order", exact: true })
    .click();
  await status("confirmed");
  await page
    .getByRole("button", { name: "Reserve stock", exact: true })
    .click();
  await pick("Stock lot (earliest expiry first)", lotNumber);
  await top().getByRole("button", { name: "Save", exact: true }).click();
  await status("confirmed");
  await page
    .getByRole("button", { name: "Create delivery", exact: true })
    .click();
  const qtyInput = top().getByRole("textbox").first();
  await qtyInput.fill("5");
  await top()
    .getByLabel("Delivery reference / remarks", { exact: true })
    .fill("Partial dispatch");
  await top()
    .getByRole("button", { name: "Create delivery draft", exact: true })
    .click();
  await status("draft");
  await action("Post movement");
  await status("posted");
  await capture("42-erp-delivery");
  await accessible();
  const delivery = (
    await db.query(
      "select id from erp_movements where order_id=$1 and kind='delivery'",
      [order.id],
    )
  ).rows[0];
  assert.equal(
    (
      await page.request.get(
        origin + "/api/erp/documents/movements/" + delivery.id,
      )
    ).status(),
    200,
  );
  assert.equal(
    (
      await page.request.get(
        origin + "/api/erp/documents/movements/" + delivery.id + "/coa/0",
      )
    ).status(),
    200,
  );
  assert.equal(
    (
      await db.query(
        "select quantity::text q from erp_balances where lot_id=$1",
        [lot.id],
      )
    ).rows[0].q,
    "95.000000",
  );
  await close();
  await page.goto(origin + "/dashboard/warehouse");
  await page.getByRole("button", { name: "Stock counts", exact: true }).click();
  await page.getByRole("button", { name: "Plan count", exact: true }).click();
  await pick("Location", "ERP-" + suffix);
  await top()
    .getByLabel("Reference", { exact: true })
    .fill("Physical verification");
  await top()
    .getByRole("button", { name: "Plan stock count", exact: true })
    .click();
  await status("draft");
  await action("Start count & freeze location");
  await status("counting");
  await page.getByRole("button", { name: "Enter count", exact: true }).click();
  await top().getByLabel("Counted quantity (kg)", { exact: true }).fill("96");
  await top().getByRole("button", { name: "Save", exact: true }).click();
  await status("counting");
  await action("Submit count");
  await status("submitted");
  await action("Approve adjustment", "Verified overage");
  await status("posted");
  await capture("43-erp-stock-count");
  await accessible();
  await close();
  assert.equal(
    (
      await db.query(
        "select quantity::text q from erp_balances where lot_id=$1 and location_id=$2",
        [lot.id, location],
      )
    ).rows[0].q,
    "96.000000",
  );
  const csv = await page.request.get(
    origin + "/api/erp/export/stock?q=" + encodeURIComponent(lotNumber),
  );
  assert.equal(csv.status(), 200);
  assert.match(await csv.text(), new RegExp(lotNumber));
  // Disabling blocks reads and writes even with a valid session, without removing history.
  await post("set_module", { module: "production", state: "disabled" });
  assert.equal(
    (await page.request.get(origin + "/api/erp/production")).status(),
    403,
  );
  await page.goto(origin + "/dashboard/production");
  await page.getByRole("heading", { name: "Module unavailable" }).waitFor();
  await post("set_module", { module: "production", state: "active" });
  await post("set_module", { module: "quality", state: "disabled" });
  assert.equal(
    (await page.request.get(origin + "/api/data/hasil_uji")).status(),
    403,
  );
  assert.equal(
    (
      await page.request.get(
        origin +
          "/api/coa/" +
          (
            await db.query("select id from coa where id_hasil_uji=$1", [
              inspection.id,
            ])
          ).rows[0].id +
          "/pdf",
      )
    ).status(),
    403,
  );
  await post("set_module", { module: "quality", state: "active" });
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const area of ["production", "warehouse", "sales", "admin/settings"]) {
      await page.goto(origin + "/dashboard/" + area);
      await page.locator(".erp-workspace").waitFor();
      await page
        .getByText("Loading records…", { exact: true })
        .waitFor({ state: "hidden" });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "no " + area + " overflow at " + width,
      );
      await capture("44-erp-" + area + "-" + width);
      await accessible();
    }
    await page.goto(origin + "/dashboard/sales");
    await page
      .getByRole("button", { name: "New quotation", exact: true })
      .click();
    await top().getByRole("button", { name: "Add item", exact: true }).click();
    assert.ok(
      await top().evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    await capture("45-erp-quote-modal-" + width);
    await accessible();
    await page.keyboard.press("Escape");
    await submitControl(page, "Discard changes");
    await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
