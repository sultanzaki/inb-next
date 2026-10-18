import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

test("light theme preserves the original brand palette and logo", () => {
  const original = JSON.parse(
    readFileSync(
      new URL("./fixtures/brand-palette.json", import.meta.url),
      "utf8",
    ),
  );
  const css = readFileSync("src/app/globals.css", "utf8");
  const lightRoot = css.match(/:root\s*\{([^}]+)\}/)?.[1];
  assert.ok(lightRoot, "The base light palette must exist.");
  const actual = Object.fromEntries(
    [...lightRoot.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)].map(
      (match) => [match[1], match[2]],
    ),
  );
  assert.deepEqual(actual, original);
  assert.equal(
    createHash("sha256").update(readFileSync("public/logo.png")).digest("hex"),
    "5dff4b2207b33662d17ef68f6630f33af1e4b4db94dc54594b2297ea019a0213",
  );
});
