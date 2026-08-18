import assert from "node:assert/strict";
import test from "node:test";
import {
  findMatchingOption,
  selectValueForOptions,
} from "./field-links.ts";

test("matches category labels with and without emoji prefixes", () => {
  assert.equal(
    findMatchingOption(["Labels & Stickers"], "🏷️ Labels & Stickers"),
    "Labels & Stickers"
  );
  assert.equal(
    findMatchingOption(["🏷️ Labels & Stickers"], "Labels & Stickers"),
    "🏷️ Labels & Stickers"
  );
});

test("returns the exact option value required by an HTML select", () => {
  assert.equal(
    selectValueForOptions(
      ["Apparel", "Labels & Stickers"],
      "🏷️ Labels & Stickers"
    ),
    "Labels & Stickers"
  );
  assert.equal(
    selectValueForOptions(["Apparel"], "Unknown category"),
    "Unknown category"
  );
});
