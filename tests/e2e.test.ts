import { exerciseTransactionControls } from "./transaction-controls-browser";
import { exerciseOperationalUX } from "./operational-ux-browser";
import { exerciseOperationalFinance } from "./operational-finance-browser";
import { exerciseReleaseReadiness } from "./release-readiness-browser";
import { exerciseGrowth } from "./growth-browser";
import { exerciseMobileNavigation } from "./mobile-navigation-browser";
import { exerciseRelease } from "./release-browser";
import { exerciseERP } from "./erp-browser";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHmac, randomUUID, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { Client } from "pg";
import { chromium } from "playwright";

const dbUrl = "postgres://postgres:local-test-only@127.0.0.1:55432/postgres";
const origin = "http://127.0.0.1:3004";
function jwt(role: string) {
  const encode = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  const body =
    encode({ alg: "HS256", typ: "JWT" }) +
    "." +
    encode({ role, exp: Math.floor(Date.now() / 1000) + 3600 });
  return (
    body +
    "." +
    createHmac("sha256", "inb-next-integration-only-jwt-secret-32chars")
      .update(body)
      .digest("base64url")
  );
}

test(
  process.env.TEST_CONTROLS_ONLY === "1"
    ? "Phase 4 transaction controls"
    : process.env.TEST_UX_ONLY === "1"
      ? "Operational UX phases 1–3"
      : process.env.TEST_FINANCE_ONLY === "1"
        ? "Operational Finance and Service workflows"
        : process.env.TEST_RELEASE_READY_ONLY === "1"
          ? "Release theme RBAC and insights"
          : process.env.TEST_GROWTH_ONLY === "1"
            ? "Purchase CRM and product document workflows"
            : process.env.TEST_MOBILE_NAV_ONLY === "1"
              ? "Mobile console navigation"
              : process.env.TEST_ERP_ONLY === "1"
                ? "ERP production browser workflows"
                : "production app: authenticated reads, pagination, mutations, search, error handling and logout",
  { timeout: 600000 },
  async () => {
    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    const salt = randomBytes(16),
      password = "Local fixture password only";
    const username = "e2e-" + randomUUID();
    const suffix = randomUUID().slice(0, 8);
    const browserName = "Browser Product " + suffix;
    const browserLot = "BROWSER-LOT-" + suffix;
    const {
      rows: [user],
    } = await db.query(
      "insert into users(username,password_hash,role,nama_lengkap) values($1,$2,$3,$4) returning id",
      [
        username,
        `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`,
        "admin qc",
        "Pengujian Lokal",
      ],
    );
    await db.query(
      "delete from master_produk where nama_produk like 'E2E Product %'",
    );
    for (let i = 0; i < 120; i++)
      await db.query(
        "insert into master_produk(kode_produk,nama_produk,kategori,satuan,status_halal,tipe_kemasan) values($1,$2,$3,$4,$5,$6)",
        [
          "E2E-" + randomUUID(),
          "E2E Product " + String(i).padStart(3, "0"),
          "QC",
          "Kg",
          "Halal",
          "Bottle",
        ],
      );
    // Supabase clients mount PostgREST at /rest/v1; the standalone test image
    // serves it at /. This local adapter mirrors only that path mounting.
    let failRevoke = false;
    let missingPerformanceRPCs = false;
    const relay = createServer(async (req, res) => {
      if (
        process.env.TEST_UX_MISSING_RPC === "1" &&
        [
          "erp_choices",
          "erp_document_flow",
          "erp_batch_preview",
          "erp_delivery_readiness",
        ].some((name) => req.url === "/rest/v1/rpc/" + name)
      ) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            code: "PGRST202",
            message: "Local pre-migration UX fixture",
          }),
        );
        return;
      }
      if (
        process.env.TEST_QUOTE_ORDER_FALLBACK === "1" &&
        req.url === "/rest/v1/rpc/erp_quote_order"
      ) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            code: "PGRST202",
            message: "Local pre-migration quote order fixture",
          }),
        );
        return;
      }
      if (
        missingPerformanceRPCs &&
        req.method === "POST" &&
        [
          "qc_session_user",
          "qc_quality_summary",
          "qc_quality_analytics",
          "qc_global_search",
        ].some((name) => req.url === "/rest/v1/rpc/" + name)
      ) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            code: "PGRST202",
            message: "Local missing RPC rollout fixture",
          }),
        );
        return;
      }
      if (
        failRevoke &&
        req.method === "DELETE" &&
        req.url?.startsWith("/rest/v1/sessions")
      ) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end('{"message":"test revoke failure"}');
        return;
      }
      const parts: Buffer[] = [];
      for await (const part of req) parts.push(Buffer.from(part));
      const response = await fetch(
        "http://127.0.0.1:55433" + req.url!.replace(/^\/rest\/v1/, ""),
        {
          method: req.method,
          headers: Object.fromEntries(
            Object.entries(req.headers).filter(
              ([k]) => !["host", "connection", "content-length"].includes(k),
            ),
          ) as Record<string, string>,
          body: ["GET", "HEAD"].includes(req.method!)
            ? undefined
            : Buffer.concat(parts),
        },
      );
      res.writeHead(
        response.status,
        Object.fromEntries(response.headers.entries()),
      );
      res.end(
        req.method === "HEAD"
          ? undefined
          : Buffer.from(await response.arrayBuffer()),
      );
    });
    await new Promise<void>((resolve) =>
      relay.listen(55434, "127.0.0.1", resolve),
    );
    const app = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3004",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SUPABASE_URL: "http://127.0.0.1:55434",
          SUPABASE_SERVICE_ROLE_KEY: jwt("service_role"),
        },
        stdio: "ignore",
      },
    );
    let browser;
    try {
      let ready = false;
      for (let i = 0; i < 60; i++) {
        try {
          if ((await fetch(origin + "/login")).ok) {
            ready = true;
            break;
          }
        } catch {
          /* wait for owned server */
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      assert.ok(ready, "local production server started");
      assert.equal(
        (await fetch(origin + "/api/data/master_produk")).status,
        401,
      );
      assert.equal(
        (
          await fetch(origin + "/api/data/master_produk", {
            headers: { Authorization: "Bearer " + jwt("service_role") },
          })
        ).status,
        401,
      );
      assert.equal(
        (await fetch(origin + "/api/data/master_produk", { method: "POST" }))
          .status,
        405,
      );
      browser = await chromium.launch({
        headless: true,
        executablePath:
          process.env.TEST_CHROMIUM_PATH ??
          (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
        args: ["--no-sandbox", "--disable-gpu"],
        env: {
          PATH: process.env.PATH!,
          HOME: "/tmp",
          XDG_CONFIG_HOME: "/tmp/inb-test-browser",
          XDG_CACHE_HOME: "/tmp/inb-test-browser-cache",
        },
      });
      const context = await browser.newContext({
        timezoneId: "Asia/Jakarta",
        viewport: { width: 1440, height: 1000 },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      const runtimeErrors: string[] = [];
      page.on("pageerror", (e) => runtimeErrors.push(e.message));
      const artifacts =
        process.env.TEST_ARTIFACT_DIR ?? "/workspace/redesign-apple-review";
      mkdirSync(artifacts, { recursive: true });
      async function capture(name: string) {
        if (name === "03-produk-desktop")
          await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: `${artifacts}/${name}.png`,
          fullPage: name.includes("dashboard") || name.includes("login"),
          animations: "disabled",
        });
      }
      async function accessible() {
        // Evaluate resting UI, rather than the low-opacity frame of an entering panel.
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(
            document
              .getAnimations()
              .filter(
                (a) =>
                  a.playState === "running" &&
                  Number.isFinite(a.effect?.getComputedTiming().endTime),
              )
              .map((a) => a.finished.catch(() => {})),
          );
        });
        await page.addScriptTag({
          path: createRequire(import.meta.url).resolve("axe-core/axe.js"),
        });
        const violations = await page.evaluate(async () => {
          const axe = (
            window as unknown as {
              axe: {
                run: (options: unknown) => Promise<{
                  violations: {
                    id: string;
                    impact: string;
                    nodes: { target: string[] }[];
                  }[];
                }>;
              };
            }
          ).axe;
          return (
            await axe.run({
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa"],
              },
            })
          ).violations;
        });
        assert.deepEqual(
          violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            targets: v.nodes.map((n) => n.target),
          })),
          [],
        );
      }
      await db.query(
        "update erp_modules set state='disabled' where key='production'",
      );
      await page.goto(origin + "/login");
      await capture("01-login-desktop");
      await accessible();
      for (const width of [320, 375, 430]) {
        await page.setViewportSize({ width, height: 860 });
        await capture("01-login-mobile-" + width);
        await accessible();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.locator("[name=username]").fill(username);
      await page.locator("[name=password]").fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL("**/dashboard");
      await page.locator(".release-dashboard").waitFor();
      await page.goto(origin + "/dashboard/quality");
      await page.locator(".quality-summary").waitFor();
      if (process.env.TEST_UX_MISSING_RPC === "1") {
        const legacy = await page.request.get(
          origin + "/api/erp/choices/catalog",
        );
        assert.equal(legacy.status(), 200);
        const scoped = await page.request.get(
          origin +
            "/api/erp/choices/fin_payments?scope=" +
            encodeURIComponent(
              JSON.stringify({ state: "verified", positive: true }),
            ),
        );
        assert.equal(scoped.status(), 503);
        assert.match((await scoped.json()).message, /database update/);
        return;
      }
      if (process.env.TEST_CONTROLS_ONLY === "1") {
        await exerciseTransactionControls(
          page,
          db,
          origin,
          capture,
          accessible,
        );
        assert.deepEqual(runtimeErrors, []);
        return;
      }
      if (process.env.TEST_UX_ONLY === "1") {
        await exerciseOperationalUX(page, db, origin, capture, accessible);
        assert.deepEqual(runtimeErrors, []);
        return;
      }
      if (process.env.TEST_FINANCE_ONLY === "1") {
        await exerciseOperationalFinance(
          page,
          db,
          origin,
          suffix,
          capture,
          accessible,
        );
        assert.deepEqual(runtimeErrors, []);
        return;
      }
      if (process.env.TEST_RELEASE_READY_ONLY === "1") {
        await exerciseReleaseReadiness(page, db, origin, capture, accessible);
        assert.deepEqual(runtimeErrors, []);
        return;
      }
      if (process.env.TEST_GROWTH_ONLY === "1") {
        await exerciseGrowth(page, db, origin, suffix, capture, accessible);
        assert.deepEqual(runtimeErrors, []);
        return;
      }
      if (process.env.TEST_MOBILE_NAV_ONLY === "1") {
        await exerciseMobileNavigation(page, origin, capture, accessible);
        assert.deepEqual(runtimeErrors, []);
        return;
      }
      if (process.env.TEST_ERP_ONLY === "1") {
        await exerciseERP(page, db, origin, suffix, capture, accessible);
        await exerciseRelease(page, db, origin, suffix, capture, accessible);
        assert.deepEqual(runtimeErrors, []);
        return;
      }
      assert.equal(
        await page
          .getByRole("button", { name: "Refresh", exact: true })
          .count(),
        0,
      );
      const analytics = page.getByRole("region", { name: "Quality analytics" });
      await analytics.locator(".analytics-stage").waitFor();
      const analyticsResponse = await page.request.get(
        origin + "/api/dashboard/analytics?period=30",
      );
      assert.equal(analyticsResponse.status(), 200);
      assert.equal(
        analyticsResponse.headers()["cache-control"],
        "private, no-store",
      );
      const analyticsPayload = await analyticsResponse.json();
      assert.equal(analyticsPayload.buckets.length, 6);
      const expectedCounts = (
        await db.query(
          "select count(*) filter(where status='PASS')::int passed, count(*) filter(where status='FAIL')::int failed from hasil_uji where tgl_uji between $1 and $2",
          [analyticsPayload.from, analyticsPayload.to],
        )
      ).rows[0];
      assert.equal(
        analyticsPayload.buckets.reduce(
          (n: number, b: { passed: number }) => n + b.passed,
          0,
        ),
        expectedCounts.passed,
      );
      assert.equal(
        analyticsPayload.buckets.reduce(
          (n: number, b: { failed: number }) => n + b.failed,
          0,
        ),
        expectedCounts.failed,
      );
      assert.equal(
        (
          await page.request.get(origin + "/api/dashboard/analytics?period=365")
        ).status(),
        400,
      );
      await capture("02-dashboard-desktop");
      for (const name of ["Quality", "COAs", "Activity"]) {
        await analytics.getByRole("tab", { name, exact: true }).click();
        await capture("30-analytics-desktop-" + name.toLowerCase());
        await accessible();
      }
      await analytics.getByLabel("Analytics period").selectOption("90");
      await page.waitForFunction(
        () => document.querySelector(".analytics-stage") !== null,
      );
      await analytics
        .getByRole("button", { name: /passed,.*failed/ })
        .first()
        .click();
      assert.equal(
        await analytics
          .getByRole("button", { name: /passed,.*failed/ })
          .first()
          .getAttribute("aria-pressed"),
        "true",
      );
      await analytics.getByLabel("Analytics period").selectOption("30");
      await analytics.locator(".analytics-stage").waitFor();
      await page.route("**/api/dashboard/analytics?*", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"message":"test failure"}',
        }),
      );
      await page.reload();
      await analytics
        .getByRole("button", { name: "Retry analytics" })
        .waitFor();
      assert.equal(
        await analytics.locator(".analytics-number").count(),
        0,
        "a failed count is never displayed as zero",
      );
      await page.unroute("**/api/dashboard/analytics?*");
      await analytics.getByRole("button", { name: "Retry analytics" }).click();
      await analytics.locator(".analytics-stage").waitFor();
      await accessible();
      assert.ok(await page.locator(".workspace-sidebar").isVisible());
      await page.keyboard.press("Control+k");
      await page
        .getByPlaceholder("Search lots, products, or COAs…")
        .fill("Products");
      await page.keyboard.press("Enter");
      await page.waitForURL("**/dashboard/master-data/products");
      await page.waitForFunction(
        () => !document.querySelector("[role=dialog]"),
      );
      await page.locator("[data-search-input]").waitFor();
      await page.keyboard.press("/");
      assert.equal(
        await page
          .locator("[data-search-input]")
          .evaluate((el) => el === document.activeElement),
        true,
      );
      assert.equal(
        (await page.request.get(origin + "/api/data/users")).status(),
        400,
      );
      assert.equal(
        (await page.request.get(origin + "/api/data/sessions")).status(),
        400,
      );
      await page.goto(origin + "/dashboard/master-data/products");
      await page.getByPlaceholder("Search products…").fill("E2E Product");
      await page.waitForFunction(() =>
        document.querySelector("body")?.innerText.includes("120 records"),
      );
      await page.waitForFunction(
        () => document.querySelectorAll("tbody tr").length === 50,
      );
      const firstPage = await page.locator("tbody tr").allTextContents();
      await page
        .getByRole("button", { name: "Next page", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('button[aria-label="Page 2"]')
            ?.getAttribute("aria-current") === "page",
      );
      await page.waitForFunction(() =>
        document
          .querySelector("tbody")
          ?.textContent?.includes("E2E Product 050"),
      );
      const secondPage = await page.locator("tbody tr").allTextContents();
      assert.equal(secondPage.length, 50);
      assert.equal(new Set([...firstPage, ...secondPage]).size, 100);
      await page
        .getByRole("button", { name: "Next page", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelectorAll("tbody tr").length === 20,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Next page", exact: true })
          .isDisabled(),
        true,
      );
      await page
        .getByRole("button", { name: "Previous page", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelectorAll("tbody tr").length === 50,
      );
      assert.deepEqual(
        await page.locator("tbody tr").allTextContents(),
        secondPage,
      );
      await capture("03-produk-desktop");
      await accessible();
      await page
        .getByRole("button", { name: "Non-Halal", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Clear filters", exact: true })
        .waitFor();
      assert.equal(
        await page
          .locator("tbody")
          .getByText("E2E Product", { exact: false })
          .count(),
        0,
      );
      await page
        .getByRole("button", { name: "Clear filters", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelectorAll("tbody tr").length === 50,
      );
      await page
        .getByLabel("Sort records", { exact: true })
        .selectOption("newest");
      assert.equal(
        await page.getByLabel("Sort records", { exact: true }).inputValue(),
        "newest",
      );
      // Empty submission and closing an edited form preserve user intent.
      await page
        .getByRole("button", { name: "New product", exact: true })
        .first()
        .click();
      await page.getByRole("button", { name: "Add", exact: true }).click();
      assert.equal(
        await page.getByLabel(/^Product code/).getAttribute("aria-invalid"),
        "true",
      );
      await page.getByLabel(/^Product code/).fill("DRAFT-ONLY");
      await page.keyboard.press("Escape");
      await page
        .getByRole("dialog", { name: "Discard your changes?" })
        .waitFor();
      await capture("04-discard-confirmation");
      await page.getByRole("button", { name: "Back", exact: true }).click();
      assert.equal(
        await page.getByLabel(/^Product code/).inputValue(),
        "DRAFT-ONLY",
      );
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Discard changes", exact: true })
        .click();
      await page.waitForFunction(
        () => !document.querySelector("[role=dialog]"),
      );
      // Create product + canonical parameter using the real Server Action/RPC.
      await page
        .getByRole("button", { name: "New product", exact: true })
        .first()
        .click();
      await page.getByPlaceholder("PRD-001").fill("BROWSER-" + randomUUID());
      await page
        .getByPlaceholder("Product name", { exact: true })
        .fill(browserName);
      await page.getByRole("button", { name: "Add parameter" }).click();
      await page.getByPlaceholder("Parameter", { exact: true }).fill("pH");
      await page.getByPlaceholder("Min", { exact: true }).fill("6");
      await page.getByPlaceholder("Max", { exact: true }).fill("8");
      await capture("05-produk-form");
      await accessible();
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.waitForFunction(
        () => !document.querySelector("[role=dialog]"),
      );
      const p = (
        await db.query(
          "select id from master_produk where nama_produk=$1 order by created_at desc limit 1",
          [browserName],
        )
      ).rows[0];
      assert.ok(p);
      await page.goto(origin + "/dashboard/quality/inspections");
      await page
        .getByRole("button", { name: "New inspection", exact: true })
        .first()
        .click();
      await page.locator("[role=dialog] select").selectOption(p.id);
      await page.getByPlaceholder("0", { exact: true }).waitFor();
      await page.getByPlaceholder("LOT-001").fill(browserLot);
      await page
        .getByRole("button", { name: "Save draft", exact: true })
        .click();
      await page.waitForFunction(
        () => !document.querySelector("[role=dialog]"),
      );
      assert.equal(
        (
          await db.query("select id from hasil_uji where no_lot=$1", [
            browserLot,
          ])
        ).rowCount,
        0,
      );
      await page.getByRole("button", { name: /Inspection drafts/ }).click();
      await page
        .locator(".draft-row")
        .filter({ hasText: browserLot })
        .getByRole("button", { name: "Continue" })
        .click();
      assert.equal(
        await page.getByPlaceholder("LOT-001").inputValue(),
        browserLot,
      );
      await page.getByPlaceholder("Inspector name").fill("Browser Tester");
      await page.getByPlaceholder("0", { exact: true }).fill("7,5");
      await capture("06-inspeksi-form");
      await accessible();
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.waitForFunction(
        () => !document.querySelector("[role=dialog]"),
      );
      const h = (
        await db.query(
          "select * from hasil_uji where id_produk=$1 and no_lot=$2",
          [p.id, browserLot],
        )
      ).rows[0];
      assert.equal(
        (
          await db.query("select id from inspection_drafts where no_lot=$1", [
            browserLot,
          ])
        ).rowCount,
        0,
      );
      assert.equal(h.status, "PASS");
      assert.equal(h.hasil_detail[0].val, "7,5");
      await page.getByPlaceholder("Search lots or products…").fill(browserName);
      await page.getByRole("cell", { name: browserLot, exact: true }).waitFor();
      // Put the desired source beyond the first 500 available rows. It must
      // remain selectable; the old two capped queries would hide this source.
      await db.query(
        `insert into hasil_uji(id_produk,no_lot,tgl_sampling,tgl_uji,inspector,catatan,hasil_detail,status,qc_version)
      select id_produk,'EXTRA-'||i||'-'||$2,tgl_sampling,tgl_uji,inspector,catatan,hasil_detail,status,qc_version
      from hasil_uji cross join generate_series(1,501) i where id=$1`,
        [h.id, randomUUID()],
      );
      await page.goto(origin + "/dashboard/quality/certificates");
      await page
        .getByRole("button", { name: "Issue COA", exact: true })
        .first()
        .click();
      await page
        .locator("[role=dialog] select")
        .first()
        .locator("option")
        .filter({ hasText: browserLot })
        .waitFor({ state: "attached" });
      await page.locator("[role=dialog] select").first().selectOption(h.id);
      assert.equal(
        await page.locator("[role=dialog] input[type=date]").count(),
        2,
      );
      await page.locator("input[name=mfg_date]").fill("2026-10-01");
      await page.locator("input[name=tanggal_rilis]").fill("2026-10-17");
      assert.equal(
        await page.getByLabel("Expiry date", { exact: true }).textContent(),
        "2027-10-01",
      );
      await page
        .getByRole("button", { name: "Preview COA", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Issue COA", exact: true })
        .last()
        .click();
      await page.waitForFunction(
        () => !document.querySelector("[role=dialog]"),
      );
      assert.equal(
        (await db.query("select * from coa where id_hasil_uji=$1", [h.id]))
          .rowCount,
        1,
      );
      assert.equal(
        (
          await db.query(
            "select tanggal_expired::text from coa where id_hasil_uji=$1",
            [h.id],
          )
        ).rows[0].tanggal_expired,
        "2027-10-01",
      );
      await db.query("update master_produk set nama_produk=$1 where id=$2", [
        "Master renamed after certification",
        p.id,
      ]);
      await page.getByPlaceholder("Search COAs or products…").fill(browserName);
      await page.getByRole("cell", { name: browserLot, exact: true }).waitFor();
      await page.getByText(browserName, { exact: true }).waitFor();
      await capture("07-coa-desktop");
      await accessible();
      await page
        .getByRole("button", { name: "Detail", exact: true })
        .first()
        .click();
      await capture("11-coa-detail");
      await accessible();
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => !document.querySelector("[role=dialog]"),
      );
      const downloadPromise = context.waitForEvent("page");
      await page
        .getByRole("button", { name: "Print", exact: true })
        .first()
        .click();
      const printPage = await downloadPromise;
      await printPage.waitForLoadState();
      assert.match(printPage.url(), /api\/coa\/.*\/pdf/);
      const pdf = await context.request.get(printPage.url());
      assert.equal(pdf.status(), 200);
      assert.match(pdf.headers()["content-type"], /application\/pdf/);
      assert.equal((await pdf.body()).subarray(0, 4).toString(), "%PDF");
      await printPage.close();
      await exerciseERP(page, db, origin, suffix, capture, accessible);
      await exerciseRelease(page, db, origin, suffix, capture, accessible);
      await exerciseMobileNavigation(page, origin, capture, accessible);
      await exerciseGrowth(page, db, origin, suffix, capture, accessible);
      await exerciseOperationalFinance(
        page,
        db,
        origin,
        suffix,
        capture,
        accessible,
      );
      await exerciseOperationalUX(page, db, origin, capture, accessible);
      await exerciseTransactionControls(page, db, origin, capture, accessible);
      await exerciseReleaseReadiness(page, db, origin, capture, accessible);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      assert.match(
        await page
          .locator("body")
          .evaluate((el) => getComputedStyle(el).fontFamily),
        /dmSans|DM Sans/,
      );
      const longCode = "LONG-" + suffix;
      const longName =
        "Magnesium stearate " + "ExtendedProductIdentity".repeat(15);
      const longProduct = (
        await db.query(
          `insert into master_produk(kode_produk,nama_produk,kategori,satuan,status_halal,tipe_kemasan) values($1,$2,$3,'kg','Halal',$3) returning id`,
          [longCode, longName, "LongMetadata".repeat(20)],
        )
      ).rows[0];
      await db.query(
        `insert into spesifikasi(id_produk,parameter_uji,tipe_batas,keterangan,urutan) values($1,$2,'TEXT',$3,0)`,
        [
          longProduct.id,
          "LongParameter".repeat(15),
          "LongObservation".repeat(18),
        ],
      );
      await db.query(
        `insert into product_spec_versions(id_produk,version,product_snapshot,specifications,actor,revision_note) select m.id,v,to_jsonb(m),(select jsonb_agg(to_jsonb(sp)) from spesifikasi sp where sp.id_produk=m.id),'Pagination fixture','Version pagination test' from master_produk m cross join generate_series(1,55) v where m.id=$1`,
        [longProduct.id],
      );

      for (const width of [768, 375, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(origin + "/dashboard/quality");
        await page.locator(".quality-summary").waitFor();
        const mobileAnalytics = page.getByRole("region", {
          name: "Quality analytics",
        });
        await mobileAnalytics.locator(".analytics-stage").waitFor();
        const totalsY = await page
          .locator(".overview-totals strong")
          .evaluateAll((els) =>
            els.map((el) => el.getBoundingClientRect().top),
          );
        if (width < 768)
          assert.ok(
            Math.max(...totalsY) - Math.min(...totalsY) < 2,
            "KPI numbers share a baseline",
          );
        for (const name of ["Quality", "COAs", "Activity"]) {
          await mobileAnalytics.getByRole("tab", { name, exact: true }).click();
          assert.ok(
            await mobileAnalytics.evaluate(
              (el) => el.scrollWidth <= el.clientWidth + 1,
            ),
            `Quality analytics fits ${width}px while viewing ${name}`,
          );
          await mobileAnalytics.scrollIntoViewIfNeeded();
          await capture(`31-analytics-${name.toLowerCase()}-${width}`);
          await accessible();
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await capture(`09-dashboard-${width}`);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `no dashboard overflow at ${width}: ` +
            (await page.evaluate(() =>
              [...document.querySelectorAll("*")]
                .filter(
                  (el) => el.getBoundingClientRect().right > innerWidth + 1,
                )
                .slice(0, 8)
                .map((el) => el.tagName + "." + el.className)
                .join(", "),
            )),
        );
        await accessible();
        await page.goto(origin + "/dashboard/workspaces");
        await page.locator(".workspace-tile").first().waitFor();
        // Measure resting layout after navigation and hover transitions finish.
        await accessible();
        const tiles = await page.locator(".workspace-tile").evaluateAll((els) =>
          els.slice(0, 2).map((el) => {
            const r = el.getBoundingClientRect();
            return {
              name: el.textContent,
              x: r.x,
              y: (el as HTMLElement).offsetTop,
              width: r.width,
              height: r.height,
            };
          }),
        );
        assert.equal(tiles.length, 2);
        assert.ok(
          Math.abs(tiles[0].y - tiles[1].y) < 1 && tiles[1].x > tiles[0].x,
          "Two-column launcher: " + JSON.stringify(tiles),
        );
        assert.ok(tiles.every((r) => Math.abs(r.width - r.height) < 1));
        await capture("21-mobile-work-" + width);
        await accessible();
        await page
          .locator(".work-directory")
          .getByRole("link", { name: /Master data/ })
          .click();
        await page.waitForURL("**/dashboard/master-data/products");
        await page.locator(".data-toolbar").waitFor();
        await page.waitForFunction(
          () =>
            !document.querySelector<HTMLButtonElement>(
              'button[aria-label="Refresh data"]',
            )?.disabled,
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `no product overflow at ${width}`,
        );
        await page
          .getByRole("button", { name: "New product", exact: true })
          .first()
          .click();
        await page.getByRole("button", { name: "Add parameter" }).click();
        await capture(`10-produk-form-${width}`);
        await accessible();
        await page.keyboard.press("Escape");
        await page
          .getByRole("button", { name: "Discard changes", exact: true })
          .click();
        await page.waitForFunction(
          () => !document.querySelector("[role=dialog]"),
        );
      }
      for (const width of [375, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(
          origin + "/dashboard/master-data/products?q=" + longCode,
        );
        await page.getByText(longName, { exact: true }).waitFor();
        const actions = page
          .locator("tbody tr")
          .filter({ hasText: longCode })
          .locator(".row-actions");
        assert.equal(
          await actions.locator(".row-actions-desktop").isVisible(),
          false,
        );
        const dataCell = await actions
          .locator("xpath=ancestor::tr")
          .locator("td")
          .first()
          .boundingBox();
        const actionCell = await actions
          .locator("xpath=ancestor::td")
          .boundingBox();
        assert.ok(
          dataCell &&
            actionCell &&
            dataCell.x + dataCell.width <= actionCell.x + 1,
          "mobile identity stays clear of the action column",
        );

        assert.ok(
          (await actions.locator(".row-actions-mobile").boundingBox())!.width <=
            44,
        );
        await actions
          .getByRole("button", { name: "Row actions", exact: true })
          .click();
        await page
          .getByRole("menuitem", { name: "Product details", exact: true })
          .click();
        const modal = page.getByRole("dialog");
        await modal
          .getByRole("heading", { name: longName, exact: true })
          .waitFor();
        const parameterCard = modal
          .locator(".specification-parameters")
          .first()
          .locator(".parameter-mobile-card")
          .filter({ hasText: "LongParameter".repeat(15) });
        await parameterCard.waitFor();
        assert.ok(
          (await parameterCard.boundingBox())!.height > 100,
          "mobile parameter card keeps its height",
        );
        assert.equal(
          await modal.evaluate((el) => el.scrollTop),
          0,
          "details open at the top",
        );
        assert.ok(
          await modal.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          "long modal content wraps at " + width,
        );
        assert.ok(
          await modal
            .locator('[data-slot="table-container"]')
            .evaluateAll((els) =>
              els.every((el) => el.scrollWidth <= el.clientWidth + 1),
            ),
          "modal tables wrap at " + width,
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          "page does not overflow at " + width,
        );
        await parameterCard.scrollIntoViewIfNeeded();
        assert.ok(
          await parameterCard.evaluate((el) => {
            const card = el.getBoundingClientRect();
            const parent = el
              .closest('[role="dialog"]')!
              .getBoundingClientRect();
            return (
              card.bottom > parent.top &&
              card.top < parent.bottom &&
              el.parentElement!.getBoundingClientRect().height > 100
            );
          }),
          "parameters are painted inside the modal, not collapsed",
        );
        await capture("20-long-product-modal-" + width);
        await accessible();
        await page.keyboard.press("Escape");
        await page.waitForFunction(
          () => !document.querySelector("[role=dialog]"),
        );
      }
      await page.setViewportSize({ width: 375, height: 650 });
      await page
        .getByRole("navigation", { name: "Mobile navigation" })
        .getByRole("button", { name: "Search", exact: true })
        .click();
      const launcherSearch = page.getByRole("combobox", {
        name: "Search all modules",
      });
      await launcherSearch.waitFor();
      await page.waitForFunction(
        () =>
          document.activeElement?.getAttribute("aria-label") ===
          "Search all modules",
      );
      await launcherSearch.fill(browserLot);
      await page
        .getByRole("option")
        .filter({ hasText: browserLot })
        .first()
        .click();
      await page.waitForURL("**/dashboard/quality/inspections?q=*");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(origin + "/dashboard/workspaces");
      assert.ok(
        await page
          .locator(".work-directory")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });
      for (const width of [375, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(origin + "/dashboard/master-data/products");
        await page
          .getByRole("button", { name: "Advanced filters", exact: true })
          .click();
        const filterSheet = page.getByRole("dialog", {
          name: "Filter products",
          exact: true,
        });
        await filterSheet
          .getByLabel("Filter category", { exact: true })
          .fill("no-such-category-" + suffix);
        assert.ok(
          await filterSheet.evaluate(
            (el) => el.scrollWidth <= el.clientWidth + 1,
          ),
        );
        await capture("22-mobile-filters-" + width);
        await accessible();
        await filterSheet
          .getByRole("button", { name: "Apply filters", exact: true })
          .click();
        await page.getByText("No matching results", { exact: true }).waitFor();
        await page.getByRole("button", { name: /Advanced filters/ }).click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Clear", exact: true })
          .click();
        await page
          .locator("tbody tr .row-actions-mobile button")
          .first()
          .waitFor();
        await page
          .getByRole("button", { name: "Advanced filters", exact: true })
          .click();
        await page
          .getByRole("dialog")
          .getByLabel("From date", { exact: true })
          .fill("2026-12-31");
        await page
          .getByRole("dialog")
          .getByLabel("To date", { exact: true })
          .fill("2026-01-01");
        assert.equal(
          await page
            .getByRole("dialog")
            .getByRole("button", { name: "Apply filters", exact: true })
            .isDisabled(),
          true,
        );
        await page.keyboard.press("Escape");
        await page.waitForFunction(
          () => !document.querySelector("[role=dialog]"),
        );
      }
      await page.setViewportSize({ width: 375, height: 900 });
      for (const [route, action] of [
        ["quality/inspections", "New inspection"],
        ["quality/certificates", "Issue COA"],
      ]) {
        await page.goto(origin + "/dashboard/" + route);
        await page.locator(".data-toolbar").waitFor();
        await page.waitForFunction(
          () =>
            !document.querySelector<HTMLButtonElement>(
              'button[aria-label="Refresh data"]',
            )?.disabled,
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `no ${route} overflow on mobile`,
        );
        await capture(`14-${route}-mobile`);
        await page
          .getByRole("button", { name: action, exact: true })
          .first()
          .click();
        await capture(`15-${route}-form-mobile`);
        await accessible();
        await page.keyboard.press("Escape");
        await page.waitForFunction(
          () => !document.querySelector("[role=dialog]"),
        );
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      // New account administration, forced password change and read-only boundaries.
      await page.goto(origin + "/dashboard/admin/users");
      await page.getByRole("button", { name: "Add user", exact: true }).click();
      const managedUsername = "managed-" + suffix;
      await page
        .getByLabel("Full name", { exact: true })
        .fill("Managed QA " + suffix);
      await page.getByLabel("Username", { exact: true }).fill(managedUsername);
      await page
        .getByLabel("Temporary password", { exact: true })
        .fill("Temporary QA password 2026");
      await page
        .getByRole("button", { name: "Save user", exact: true })
        .click();
      await page.getByText("@" + managedUsername, { exact: true }).waitFor();
      await capture("18-pengguna");
      await accessible();
      const usersResponse = await context.request.get(
        origin + "/api/admin/users?q=" + managedUsername,
      );
      assert.equal(usersResponse.status(), 200);
      assert.doesNotMatch(await usersResponse.text(), /password_hash|scrypt\$/);
      const restricted = await browser.newContext();
      const member = await restricted.newPage();
      await member.goto(origin + "/login");
      await member.locator("[name=username]").fill(managedUsername);
      await member
        .locator("[name=password]")
        .fill("Temporary QA password 2026");
      await member
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await member.waitForURL("**/account/password");
      assert.equal(
        (
          await restricted.request.get(origin + "/api/data/master_produk")
        ).status(),
        401,
      );
      await member
        .getByLabel("Current password", { exact: true })
        .fill("Temporary QA password 2026");
      await member
        .getByLabel("New password", { exact: true })
        .fill("Changed QA password 2026");
      await member
        .getByLabel("Confirm new password", { exact: true })
        .fill("Changed QA password 2026");
      await member
        .getByRole("button", { name: "Save password", exact: true })
        .click();
      await member.waitForURL("**/dashboard");
      assert.equal(
        (await restricted.request.get(origin + "/api/admin/users")).status(),
        403,
      );
      assert.equal(
        (await restricted.request.get(origin + "/api/audit")).status(),
        403,
      );
      assert.equal(
        (
          await restricted.request.get(origin + "/api/data/inspection_drafts")
        ).status(),
        403,
      );
      const managedRow = page
        .getByRole("row")
        .filter({ hasText: managedUsername });
      await managedRow
        .getByRole("button", { name: "Reset password", exact: true })
        .click();
      await page
        .getByLabel("Temporary password", { exact: true })
        .fill("Reset QA password 2026");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Reset password", exact: true })
        .click();
      await page.waitForFunction(
        () => !document.querySelector("[role=dialog]"),
      );
      assert.equal(
        (
          await restricted.request.get(origin + "/api/data/master_produk")
        ).status(),
        401,
      );
      await member.goto(origin + "/login");
      await member.locator("[name=username]").fill(managedUsername);
      await member.locator("[name=password]").fill("Reset QA password 2026");
      await member
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await member.waitForURL("**/account/password");
      await member
        .getByRole("button", { name: "Sign out", exact: true })
        .click();
      await member.waitForURL("**/login");
      assert.equal(
        await member
          .getByText("Could not sign out. Retry.", { exact: true })
          .count(),
        0,
      );
      await restricted.close();
      await page.goto(origin + "/dashboard/admin/audit-log");
      await page
        .getByRole("heading", { name: "Audit log", exact: true })
        .waitFor();
      await capture("19-audit");
      await accessible();
      // Filtered exports include only the requested records; XLSX is a real ZIP workbook.
      const csv = await context.request.get(
        origin +
          "/api/export?" +
          new URLSearchParams({
            module: "produk",
            search: browserName,
            filter: "all",
            order: "default",
            format: "csv",
          }),
      );
      assert.equal(csv.status(), 200);
      assert.doesNotMatch(await csv.text(), /E2E Product/);
      const xlsx = await context.request.get(
        origin +
          "/api/export?" +
          new URLSearchParams({
            module: "produk",
            search: browserName,
            filter: "all",
            order: "default",
            format: "xlsx",
          }),
      );
      assert.equal(xlsx.status(), 200);
      assert.equal((await xlsx.body()).subarray(0, 2).toString(), "PK");
      const searchResponse = await context.request.get(
        origin + "/api/search?q=" + encodeURIComponent(browserLot),
      );
      assert.equal(searchResponse.status(), 200);
      const searchResults = await searchResponse.json();
      assert.ok(
        searchResults.results.some((r: { type: string }) => r.type === "COA"),
      );
      // Deploying the app before migration 008 must preserve existing reads.
      const currentAnalytics = await (
        await context.request.get(origin + "/api/dashboard/analytics?period=30")
      ).json();
      missingPerformanceRPCs = true;
      try {
        const rolloutAnalytics = await context.request.get(
          origin + "/api/dashboard/analytics?period=30",
        );
        assert.equal(rolloutAnalytics.status(), 200);
        assert.deepEqual(await rolloutAnalytics.json(), currentAnalytics);
        const rolloutSummary = await context.request.get(
          origin + "/api/dashboard/summary",
        );
        assert.equal(rolloutSummary.status(), 200);
        assert.ok((await rolloutSummary.json()).recent_inspeksi.length <= 8);
        const rolloutSearch = await context.request.get(
          origin + "/api/search?q=" + encodeURIComponent(browserLot),
        );
        assert.equal(rolloutSearch.status(), 200);
        assert.ok(
          (await rolloutSearch.json()).results.some(
            (r: { type: string }) => r.type === "COA",
          ),
        );
      } finally {
        missingPerformanceRPCs = false;
      }
      // Every primary list replaces rows when changing pages.
      const pagingPrefix = "Paging-" + suffix + "-";
      await db.query(
        `insert into dokumen_arsip(judul_dokumen,kategori,tanggal_berlaku,masa_kadaluarsa) select $1||i,'QA','2026-01-01','2028-01-01' from generate_series(1,60) i`,
        [pagingPrefix],
      );
      await db.query(
        `insert into users(username,password_hash,role,nama_lengkap) select $1||i,$2,'viewer',$1||i from generate_series(1,60) i`,
        [
          pagingPrefix,
          `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`,
        ],
      );
      await db.query(
        `insert into audit_log(user_name,aksi,referensi) select $1||i,'QA_PAGING',$1||i from generate_series(1,60) i`,
        [pagingPrefix],
      );
      await db.query(
        `insert into coa(no_coa,id_produk,id_hasil_uji,no_lot,tanggal_rilis,tanggal_expired,hasil_uji_snapshot,tanda_tangan_digital) select $1||row_number() over(order by h.id),h.id_produk,h.id,h.no_lot,'2026-01-01','2028-01-01',jsonb_build_object('produk',$1,'items',h.hasil_detail,'ts',h.tgl_sampling,'tu',h.tgl_uji),'QA' from hasil_uji h where h.id_produk=$2 and h.no_lot like 'EXTRA-%' and not exists(select from coa c where c.id_hasil_uji=h.id) limit 60`,
        [pagingPrefix, p.id],
      );
      async function verifyPages(
        route: string,
        placeholder: string,
        term: string,
        lastCount = 10,
      ) {
        await page.goto(origin + "/dashboard/" + route);
        await page.getByPlaceholder(placeholder).fill(term);
        await page
          .getByText((lastCount === 50 ? 501 : 60) + " records", {
            exact: true,
          })
          .waitFor();
        await page.waitForFunction(
          () => document.querySelectorAll("tbody tr").length === 50,
        );
        await page
          .getByRole("button", { name: "Next page", exact: true })
          .waitFor();
        await page.waitForFunction(
          () =>
            !document.querySelector<HTMLButtonElement>(
              'button[aria-label="Next page"]',
            )?.disabled,
        );
        const first = await page.locator("tbody tr").allTextContents();
        await page
          .getByRole("button", { name: "Next page", exact: true })
          .click();
        await page.waitForFunction(
          () =>
            document
              .querySelector('button[aria-label="Page 2"]')
              ?.getAttribute("aria-current") === "page",
        );
        assert.equal(await page.locator("tbody tr").count(), lastCount);
        assert.equal(
          new Set([
            ...first,
            ...(await page.locator("tbody tr").allTextContents()),
          ]).size,
          50 + lastCount,
        );
        await page
          .getByRole("button", { name: "Previous page", exact: true })
          .click();
        await page.waitForFunction(
          () =>
            document
              .querySelector('button[aria-label="Page 1"]')
              ?.getAttribute("aria-current") === "page",
        );
        assert.deepEqual(
          await page.locator("tbody tr").allTextContents(),
          first,
        );
      }
      await verifyPages(
        "quality/certificates",
        "Search COAs or products…",
        pagingPrefix,
      );
      await verifyPages(
        "admin/users",
        "Search names or usernames…",
        pagingPrefix,
      );
      await verifyPages(
        "admin/audit-log",
        "Search users, actions, or references…",
        pagingPrefix,
      );
      const extraLot = (
        await db.query(
          "select no_lot from hasil_uji where id_produk=$1 and no_lot like 'EXTRA-%' limit 1",
          [p.id],
        )
      ).rows[0].no_lot;
      await verifyPages(
        "quality/inspections",
        "Search lots or products…",
        extraLot.slice(-36),
        50,
      );
      await page.goto(origin + "/dashboard/master-data/products?q=" + longCode);
      await page.getByText(longName, { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Product details", exact: true })
        .click();
      const history = page
        .getByRole("dialog")
        .getByRole("navigation", { name: "Table pagination" });
      await history
        .getByRole("button", { name: "Next page", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByLabel("Specification version", { exact: true })
        .locator("option")
        .first()
        .waitFor({ state: "attached" });
      await page.waitForFunction(
        () =>
          document
            .querySelector('[role="dialog"] button[aria-label="Page 2"]')
            ?.getAttribute("aria-current") === "page",
      );
      assert.equal(
        await page
          .getByRole("dialog")
          .getByLabel("Specification version", { exact: true })
          .locator("option")
          .count(),
        5,
      );
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => !document.querySelector("[role=dialog]"),
      );
      async function signInAfterRoleChange() {
        assert.equal(
          (await db.query("select from sessions where user_id=$1", [user.id]))
            .rowCount,
          0,
          "a role change revokes the previous session",
        );
        assert.equal(
          (await page.request.get(origin + "/api/data/master_produk")).status(),
          401,
        );
        await page.goto(origin + "/login");
        await page.locator("[name=username]").fill(username);
        await page.locator("[name=password]").fill(password);
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await page.waitForURL("**/dashboard");
      }
      await db.query("update users set role=$1 where id=$2", [
        "viewer",
        user.id,
      ]);
      await signInAfterRoleChange();
      await page.goto(origin + "/dashboard/master-data/products");
      await page
        .getByRole("button", { name: "Product details" })
        .first()
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "New product", exact: true })
          .count(),
        0,
      );
      await page
        .getByRole("button", { name: "Product details" })
        .first()
        .click();
      await page.getByRole("heading", { name: "Test parameters" }).waitFor();
      await capture("13-produk-detail-viewer");
      await accessible();
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => !document.querySelector("[role=dialog]"),
      );
      await db.query("update users set role=$1 where id=$2", [
        "admin qc",
        user.id,
      ]);
      await signInAfterRoleChange();
      await page.goto(origin + "/dashboard/quality/certificates");
      await page.setViewportSize({ width: 375, height: 900 });
      const missing = await page.goto(origin + "/halaman-tidak-ada");
      assert.ok([200, 404].includes(missing?.status() ?? 0));
      const robots = await page
        .locator('meta[name="robots"]')
        .evaluateAll((elements) =>
          elements.map((el) => el.getAttribute("content") || ""),
        );
      assert.ok(
        robots.length > 0 && robots.every((value) => /noindex/.test(value)),
      );
      await page
        .getByRole("heading", { name: "Back to your workspace" })
        .waitFor();
      await capture("17-not-found-mobile");
      await accessible();
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(origin + "/dashboard/quality/certificates");
      // Dependency errors must not masquerade as an empty source list.
      await page.route("**/api/data/available_hasil_uji?**", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"message":"test failure"}',
        }),
      );
      await page.reload();
      await page
        .getByRole("button", { name: "Issue COA", exact: true })
        .first()
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "Could not load test results." })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Preview COA", exact: true })
          .isDisabled(),
        true,
      );
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => !document.querySelector("[role=dialog]"),
      );
      await page.getByRole("button", { name: "Open account menu" }).click();
      failRevoke = true;
      await page
        .getByRole("menuitem", { name: "Sign out", exact: true })
        .click();
      await page
        .getByText("Could not sign out. Retry.", { exact: true })
        .waitFor();
      const logoutNotice = page
        .locator('[data-sonner-toast][data-removed="false"]')
        .filter({ hasText: "Could not sign out. Retry." });
      // Retry remains available until the user dismisses the failure or retries.
      await logoutNotice.hover();
      assert.equal(
        (await db.query("select from sessions where user_id=$1", [user.id]))
          .rowCount,
        1,
      );
      assert.ok(
        (await context.cookies()).some((c) => c.name === "session_token"),
      );
      failRevoke = false;
      assert.ok(
        await page
          .getByRole("button", { name: "Open account menu" })
          .evaluate((el) => {
            const rect = el.getBoundingClientRect();
            return el.contains(
              document.elementFromPoint(
                rect.x + rect.width / 2,
                rect.y + rect.height / 2,
              ),
            );
          }),
        "logout failure never covers the account controls",
      );
      await logoutNotice
        .getByRole("button", { name: "Retry", exact: true })
        .click();
      await page.waitForURL("**/login");
      // Sonner schedules dismissal on the next animation frame; navigation can
      // finish first. Wait for that state change before checking active errors.
      await logoutNotice.waitFor({ state: "detached", timeout: 2000 });
      assert.equal(
        await page
          .locator('[data-sonner-toast][data-removed="false"]')
          .filter({ hasText: "Could not sign out. Retry." })
          .count(),
        0,
        "successful logout never reports an active error",
      );
      // Sonner keeps a dismissed notification mounted during its exit animation.
      await page
        .getByText("Could not sign out. Retry.", { exact: true })
        .waitFor({ state: "detached", timeout: 2000 });
      assert.equal(
        (await db.query("select from sessions where user_id=$1", [user.id]))
          .rowCount,
        0,
      );
      assert.equal(
        (await page.request.get(origin + "/api/data/master_produk")).status(),
        401,
      );
      assert.equal(
        (await page.request.get(origin + "/api/dashboard/analytics")).status(),
        401,
      );
      await page.setViewportSize({ width: 375, height: 900 });
      await capture("16-login-mobile");
      await accessible();
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.ok(
        await page
          .locator(".login-form-card")
          .evaluate(
            (el) => parseFloat(getComputedStyle(el).animationDuration) < 0.01,
          ),
      );
      assert.deepEqual(runtimeErrors, []);
    } finally {
      if (browser) await browser.close();
      app.kill();
      relay.close();
      await db.end();
    }
  },
);
