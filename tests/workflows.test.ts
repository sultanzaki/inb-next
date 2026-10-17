import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PDFDocument } from "pdf-lib";
import { renderCoaPdf, type CoaDocument } from "../src/lib/pdf/coa-document";
import { csvCell, toCsv } from "../src/lib/export-data";
import { dataUrl } from "../src/lib/data-access";
import {
  draftSchema,
  inspectionSchema,
  changePasswordSchema,
} from "../src/lib/domain/validation";
const uuid = "11111111-1111-4111-8111-111111111111";
const fixture: CoaDocument = {
  no_coa: "QC-TEST-001",
  no_lot: "BATCH-TEST",
  tanggal_rilis: "2026-10-17",
  tanggal_expired: "2028-10-17",
  mfg_date: "2026-10-01",
  tanda_tangan_digital: "QC Officer",
  language: "en",
  inci_name: "Test INCI",
  delivery_date: "2026-10-18",
  compliance_statement: "Conforms to the approved internal specification.",
  hasil_uji_snapshot: {
    ts: "2026-10-16",
    tu: "2026-10-17",
    produk: "Produk pengujian",
    produk_en: "QA Test Product",
    items: Array.from({ length: 22 }, (_, i) => ({
      p: "Parameter " + i,
      p_en: "Test " + i,
      t: "MAX" as const,
      mn: "",
      mx: "10",
      u: "%",
      k: "",
      val: "5",
      st: "PASS" as const,
    })),
  },
};
test("CSV prevents formula execution and preserves quotes, commas and newlines", () => {
  for (const s of ["=cmd()", " +SUM(A1)", "@evil", "-1", "\tformula"])
    assert.ok(csvCell(s).startsWith("\"'"));
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"');
  assert.ok(toCsv(["Kode"], [["001"]]).startsWith('\uFEFF"Kode"\r\n"001"'));
});
test("read gateway disallows embedding credential and session relations", () => {
  for (const select of [
    "*,users(*)",
    "*,users!inspection_drafts_owner_id_fkey(password_hash)",
    "*,sessions(*)",
    "*,master_produk(*,users(*))",
  ])
    assert.equal(
      dataUrl(
        "https://example.com",
        "inspection_drafts",
        "?select=" + encodeURIComponent(select),
      ),
      null,
    );
  assert.ok(
    dataUrl(
      "https://example.com",
      "hasil_uji",
      "?select=id,master_produk!inner(kode_produk,nama_produk)",
    ),
  );
});
test("drafts accept incomplete forms while final FAIL and password changes require explanations and confirmation", () => {
  assert.equal(
    draftSchema.safeParse({
      data: {
        id_produk: "",
        no_lot: "",
        tgl_sampling: "",
        tgl_uji: "",
        inspector: "",
        catatan: "",
        hasil_detail: [],
      },
    }).success,
    true,
  );
  const final = {
    id_produk: uuid,
    no_lot: "LOT",
    tgl_sampling: "2026-10-17",
    tgl_uji: "2026-10-17",
    inspector: "QC",
    catatan: "",
    status: "FAIL",
    hasil_detail: [{ spec_id: uuid, p: "pH", val: "99" }],
  };
  assert.equal(inspectionSchema.safeParse(final).success, false);
  assert.equal(
    inspectionSchema.safeParse({ ...final, failure_reason: "Di luar batas." })
      .success,
    true,
  );
  assert.equal(
    changePasswordSchema.safeParse({
      current_password: "old",
      password: "long enough password",
      confirmation: "wrong",
    }).success,
    false,
  );
});
test("server PDF follows A4 reference, splits 22 tests, translates selected language and never retains sample body", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inb-pdf-"));
  try {
    for (const language of ["en", "id"] as const) {
      const bytes = await renderCoaPdf(
        { ...fixture, language },
        { printDate: "2026-10-17" },
      );
      const pdf = await PDFDocument.load(bytes);
      assert.equal(pdf.getPageCount(), 2);
      assert.ok(Math.abs(pdf.getPage(0).getWidth() - 595.32) < 0.1);
      const file = join(dir, language + ".pdf");
      await writeFile(file, bytes);
      const text = execFileSync("pdftotext", ["-layout", file, "-"], {
        encoding: "utf8",
      });
      assert.match(text, /QC-TEST-001/);
      assert.match(text, /BATCH-TEST/);
      assert.match(
        text,
        language === "en" ? /Certificate of Analysis/ : /Sertifikat Analisis/,
      );
      assert.match(text, language === "en" ? /Test 21/ : /Parameter 21/);
      assert.match(text, /marketing@inbionusa.com/);
      assert.match(text, /2\/2/);
      assert.doesNotMatch(
        text,
        /INDOSTER|01\.130226\.27|USP\/NF|NOT ISSUED|BELUM DITERBITKAN/,
      );
    }
    const file = join(dir, "preview.pdf");
    await writeFile(file, await renderCoaPdf(fixture, { preview: true }));
    assert.match(
      execFileSync("pdftotext", [file, "-"], { encoding: "utf8" }),
      /PREVIEW.*NOT ISSUED/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("PDF wraps long results across pages without dropping rows and rejects excessive parameters", async () => {
  const items = Array.from({ length: 40 }, (_, i) => ({
    ...fixture.hasil_uji_snapshot.items[0],
    p: "Unique parameter " + i,
    p_en: "Unique parameter " + i,
    val: "A longer observation that needs wrapping",
  }));
  const bytes = await renderCoaPdf({
    ...fixture,
    hasil_uji_snapshot: { ...fixture.hasil_uji_snapshot, items },
  });
  assert.ok((await PDFDocument.load(bytes)).getPageCount() > 2);
  await assert.rejects(
    renderCoaPdf({
      ...fixture,
      hasil_uji_snapshot: {
        ...fixture.hasil_uji_snapshot,
        items: Array(201).fill(items[0]),
      },
    }),
    /Terlalu banyak/,
  );
});

test("preview proof rejects altered forms, changed source revisions, malformed tokens and expiry", async () => {
  const { createPreviewProof, verifyPreviewProof } =
    await import("../src/lib/pdf/preview-proof");
  const { issueSchema } = await import("../src/lib/domain/validation");
  const before = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "local-test-proof-key-only";
  const clock = Date.now;
  try {
    const form = issueSchema.parse({
      id_hasil: uuid,
      no_coa: "",
      tanggal_rilis: "2026-10-17",
      tanggal_expired: "2028-10-17",
      mfg_date: "",
      tanda_tangan: "QC",
      language: "en",
    });
    const source = {
      document: fixture,
      sourceUpdatedAt: "first",
      productUpdatedAt: "first",
    };
    const proof = createPreviewProof(form, source);
    assert.equal(verifyPreviewProof(proof, form, source), true);
    assert.equal(
      verifyPreviewProof(proof, { ...form, language: "id" }, source),
      false,
    );
    assert.equal(
      verifyPreviewProof(proof, form, { ...source, sourceUpdatedAt: "second" }),
      false,
    );
    assert.equal(
      verifyPreviewProof(proof, form, {
        ...source,
        productUpdatedAt: "second",
      }),
      false,
    );
    assert.equal(verifyPreviewProof(proof + ".extra", form, source), false);
    Date.now = () => clock() + 16 * 60 * 1000;
    assert.equal(verifyPreviewProof(proof, form, source), false);
  } finally {
    Date.now = clock;
    if (before === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = before;
  }
});
