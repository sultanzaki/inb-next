import { test } from "node:test";
import assert from "node:assert/strict";
import { displayNumber } from "../src/lib/erp/ux";
import { formatDecimal } from "../src/lib/number-format";
import { numericDisplay, numericEdit } from "../src/lib/erp/numeric-edit";

test("database decimals display compactly without treating decimal points as grouping", () => {
  for (const [value, expected] of [
    ["1250.750000", "1.250,75"],
    ["1000.000000", "1.000"],
    ["0.000001", "0,000001"],
    ["1000000", "1.000.000"],
    ["-1234.50", "-1.234,5"],
    ["", ""],
  ])
    assert.equal(numericDisplay(value), expected);
});
test("each keystroke groups immediately and sends only canonical decimals", () => {
  let shown = "";
  for (const digit of "1234567") {
    const next = numericEdit(shown + digit, shown.length + 1, true);
    shown = next.text;
    assert.equal(next.value, shown.replaceAll(".", ""));
    assert.equal(next.caret, shown.length);
  }
  assert.equal(shown, "1.234.567");
  assert.deepEqual(numericEdit(shown + ",", shown.length + 1, true), {
    text: "1.234.567,",
    value: "1234567",
    caret: 10,
    valid: true,
  });
  assert.equal(numericEdit("1.234.567,05", 12, true).value, "1234567.05");
});
test("regrouping middle insertions and deletions preserves cursor position", () => {
  assert.deepEqual(numericEdit("12.934", 4, true), {
    text: "12.934",
    value: "12934",
    caret: 4,
    valid: true,
  });
  assert.deepEqual(numericEdit("1.2345", 6, true), {
    text: "12.345",
    value: "12345",
    caret: 6,
    valid: true,
  });
  assert.deepEqual(numericEdit("1.34", 2, true), {
    text: "134",
    value: "134",
    caret: 1,
    valid: true,
  });
  assert.equal(numericEdit("1234.567", 1, true).caret, 1);
  assert.deepEqual(numericEdit(",123", 1, true), {
    text: "0,123",
    value: "0.123",
    caret: 2,
    valid: true,
  });
  assert.equal(numericEdit("-,123", 2, true).caret, 3);
});
test("paste validates separators and never silently changes ambiguous numbers", () => {
  assert.equal(numericEdit("Rp 12.500.000,50", 16).value, "12500000.50");
  for (const value of ["1.5", "1.2.3", "1e6", "NaN", "abc", "1,2,3"])
    assert.equal(numericEdit(value, value.length).valid, false);
  assert.equal(
    numericEdit("999.999.999.999.999,123456", 26).value,
    "999999999999999.123456",
  );
  assert.equal(numericEdit(",25", 3, true).value, "0.25");
  assert.equal(numericEdit("00012", 5, true).text, "12");
  assert.equal(numericEdit("-", 1, true).valid, false);
});

test("read-only quantities and percentages trim padding without rounding meaningful digits", () => {
  for (const [raw, expected] of [
    ["200.000000", "200"],
    ["10.0000", "10"],
    ["2.5000", "2,5"],
    ["200.125000", "200,125"],
    ["0.000001", "0,000001"],
    ["999999999999999.123456", "999.999.999.999.999,123456"],
    ["-200.125000", "-200,125"],
    ["0.000000", "0"],
  ])
    assert.equal(displayNumber(raw), expected);
  assert.equal(formatDecimal("1250.750000", { locale: "en-US" }), "1,250.75");
  assert.equal(formatDecimal("10.0000", { locale: "en-US" }), "10");
  assert.equal(formatDecimal(null), "—");
  assert.equal(formatDecimal("not a number"), "not a number");
  assert.equal(numericEdit("200,00", 6, true).text, "200,00");
  assert.equal(numericEdit("200,", 4, true).text, "200,");
  assert.equal(numericDisplay("200.00"), "200");
});
