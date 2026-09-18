import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRespondOrderRows,
  partitionRespondOrderRows,
} from "./respond-order.ts";

test("includes Depth with Width and Height as a size group", () => {
  const rows = buildRespondOrderRows(null, {
    Category: "Packaging",
    Product: "Box",
    Materials: "SBS",
    Die: "D-100",
    Width: "12",
    Height: "8",
    Depth: "3",
  }, {});

  const labels = rows.map((r) => r.label);
  assert.ok(labels.includes("Depth"));
  assert.equal(rows.find((r) => r.label === "Width")?.group, "size");
  assert.equal(rows.find((r) => r.label === "Height")?.group, "size");
  assert.equal(rows.find((r) => r.label === "Depth")?.group, "size");

  const { before, size, after } = partitionRespondOrderRows(rows);
  assert.deepEqual(
    size.map((r) => r.label),
    ["Width", "Height", "Depth"]
  );
  assert.ok(before.some((r) => r.label === "Die"));
  assert.ok(before.some((r) => r.label === "Product"));
  assert.equal(after.length, 0);
});

test("omits Die Cut when Die is set", () => {
  const rows = buildRespondOrderRows(null, {
    Die: "D-100",
    "Die Cut": "yes",
    Width: "12",
    Height: "8",
  }, {});
  assert.ok(!rows.some((r) => r.label.toLowerCase() === "die cut"));
  assert.ok(rows.some((r) => r.label === "Die"));
});

test("keeps Die Cut when Die is empty", () => {
  const rows = buildRespondOrderRows(null, {
    "Die Cut": "square",
    Width: "4",
  }, {});
  assert.ok(rows.some((r) => r.label === "Die Cut"));
});

test("appends leftover filled fields and non-duplicate spec_display rows", () => {
  const rows = buildRespondOrderRows(
    null,
    {
      Product: "Label",
      Finishing: "Gloss",
      Color: "4/0",
    },
    {
      spec_display: [
        { key: "PRODUCT", label: "Product", value: "Label" },
        { key: "FOIL", label: "Foil", value: "Gold" },
      ],
    }
  );
  assert.ok(rows.some((r) => r.label === "Finishing" && r.value === "Gloss"));
  assert.ok(rows.some((r) => r.label === "Color" && r.value === "4/0"));
  assert.equal(rows.filter((r) => r.label === "Product").length, 1);
  assert.ok(rows.some((r) => r.label === "Foil" && r.value === "Gold"));
});
