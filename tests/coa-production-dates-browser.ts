import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import type { Page } from "playwright";
import { submitControl } from "./confirmation-browser";
export async function exerciseCoaProductionDates(
  page: Page,
  db: Client,
  origin: string,
  capture: (s: string) => Promise<void>,
  accessible: () => Promise<void>,
) {
  const token = (await page.context().cookies(origin)).find(
    (c) => c.name === "session_token",
  )!.value;
  const uid = (
    await db.query("select user_id from sessions where token=$1", [token])
  ).rows[0].user_id;
  await db.query("update erp_modules set state='active' where key='quality'");
  const key = randomUUID();
  const dates = (
    await db.query(
      "select erp_today()::text today,(erp_today()-1)::text mfg,((erp_today()-1)+interval '1 year')::date::text expiry",
    )
  ).rows[0];
  const pid = (
    await db.query(
      "insert into master_produk(kode_produk,nama_produk,kategori,satuan,tipe_kemasan) values($1,'Production STEARATE 200','Chemical','kg','Bag') returning id",
      [key],
    )
  ).rows[0].id;
  const hid = (
    await db.query(
      "insert into hasil_uji(id_produk,no_lot,tgl_sampling,tgl_uji,inspector,hasil_detail,status,qc_version) values($1,$2,$3,$3,'QC test',$4,'PASS',1) returning id",
      [
        pid,
        key,
        dates.mfg,
        JSON.stringify([
          { p: "Assay", t: "MIN", mn: "1", mx: "", val: "2", st: "PASS" },
        ]),
      ],
    )
  ).rows[0].id;
  const lid = (
    await db.query(
      "insert into erp_lots(product_id,number,inspection_id,qc_status,mfg_date,expiry_date) values($1,$2,$3,'released',$4,$5) returning id",
      [pid, key, hid, dates.mfg, dates.expiry],
    )
  ).rows[0].id;
  const loc = (
    await db.query(
      "insert into erp_locations(code,name) values($1,'COA test') returning id",
      [key.slice(0, 20)],
    )
  ).rows[0].id;
  const mid = (
    await db.query(
      "insert into erp_movements(number,kind,state,date,lines,created_by) values($1,'production','posted',$2,'[]',$3) returning id",
      [key, dates.mfg, uid],
    )
  ).rows[0].id;
  await db.query(
    "insert into erp_ledger(movement_id,line,lot_id,location_id,delta) values($1,1,$2,$3,10)",
    [mid, lid, loc],
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + "/dashboard/quality/certificates");
  await page
    .getByRole("button", { name: "Issue COA", exact: true })
    .first()
    .click();
  const selection = page.locator("[role=dialog] select").first();
  await selection
    .locator(`option[value="${hid}"]`)
    .waitFor({ state: "attached" });
  await selection.selectOption(hid);
  const mfg = page.locator("input[name=mfg_date]");
  assert.equal(await mfg.inputValue(), dates.mfg);
  assert.equal(await mfg.getAttribute("readonly"), "");
  assert.equal(
    await page.locator("input[name=tanggal_rilis]").inputValue(),
    dates.today,
  );
  assert.equal(
    await page.getByLabel("Expiry date", { exact: true }).textContent(),
    dates.expiry,
  );
  await page
    .getByText(
      "Taken from the posted production/stock record. Change the release date separately.",
      { exact: true },
    )
    .waitFor();
  await capture("coa-production-dates-mobile");
  await accessible();
  const invalid = await page.request.post(origin + "/api/coa/preview", {
    headers: { origin },
    data: {
      id_hasil: hid,
      no_coa: "",
      mfg_date: dates.today,
      tanggal_rilis: dates.today,
      tanda_tangan: "COA test",
      language: "en",
    },
  });
  assert.equal(invalid.status(), 422);
  assert.match((await invalid.json()).message, /Production dates changed/);
  await page.getByRole("button", { name: "Preview COA", exact: true }).click();
  await submitControl(page.getByRole("dialog").last(), "Issue COA");
  await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
  const coa = (
    await db.query(
      "select mfg_date,tanggal_expired::text,tanggal_rilis::text from coa where id_hasil_uji=$1",
      [hid],
    )
  ).rows[0];
  assert.deepEqual(coa, {
    mfg_date: dates.mfg,
    tanggal_expired: dates.expiry,
    tanggal_rilis: dates.today,
  });
  assert.equal(
    (await db.query("select mfg_date::text d from erp_lots where id=$1", [lid]))
      .rows[0].d,
    dates.mfg,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
}
