import assert from "node:assert/strict";
import test from "node:test";
import { buildJobTicketSpecRows } from "./job-ticket-spec-rows.ts";
import type { CustomField } from "./types.ts";

function field(
  id: string,
  name: string,
  field_type: CustomField["field_type"] = "text",
  position = 0
): CustomField {
  return {
    id,
    tenant_id: "tenant",
    name,
    field_type,
    options: [],
    position,
    required: false,
  };
}

test("job ticket mirrors all filled cardboard fields and SKU information", () => {
  const customFields = [
    field("category", "Category", "select", 1),
    field("product", "Product", "select", 2),
    field("materials", "Materials", "select", 3),
    field("design-list", "Design List", "text", 4),
    field("qty-roll", "Qty Per Roll", "number", 5),
    field("width", "Width", "number", 6),
    field("height", "Height", "number", 7),
    field("finishing", "Finishing", "select", 8),
    field("sides", "Sides", "select", 9),
    field("roll", "Roll Direction", "select", 10),
    field("die", "Die", "text", 11),
    field("zipper", "Zipper", "text", 12),
  ];
  const rows = buildJobTicketSpecRows({
    customFields,
    fieldValues: {
      category: "Labels & Stickers",
      product: "Roll Labels",
      materials: "White Label (White BOPP)",
      "design-list": "flavor 500, flavor 200, flavor 300",
      "qty-roll": 500,
      width: 2,
      height: 4,
      finishing: "Matte Lamination",
      sides: "Single-sided",
      roll: "",
      die: "HM 2oz Label",
      zipper: "Cr",
    },
    specs: {
      spec_selections: {
        ZIPPER: "Child-Resistant (CR) zipper",
      },
    },
    skus: [{ id: "sku-1", name: "Roll Labels", qty: 1000 }],
  });

  const pairs = rows.map((row) => `${row.label}:${row.value}`);
  assert.equal(pairs.some((pair) => pair.startsWith("Design List:")), false);
  assert.ok(pairs.includes("Qty Per Roll:500"));
  assert.ok(pairs.includes("Width:2"));
  assert.ok(pairs.includes("Height:4"));
  assert.ok(pairs.includes("Die:HM 2oz Label"));
  assert.ok(pairs.includes("Zipper:Cr"));
  assert.ok(pairs.includes("Zipper:Child-Resistant (CR) zipper"));
  assert.ok(pairs.includes("Quantity:1,000"));
  assert.ok(pairs.includes("SKU Qty:1"));
  assert.ok(pairs.includes("SKU 1:Roll Labels · Qty 1,000"));
  assert.equal(pairs.some((pair) => pair.startsWith("Roll Direction:")), false);
  assert.equal(pairs.some((pair) => pair.startsWith("Size (W, H):")), false);
});

test("job ticket excludes Design List from product specifications", () => {
  const rows = buildJobTicketSpecRows({
    customFields: [field("design-list", "Design List", "text", 1)],
    fieldValues: {
      "design-list": "Design A 300\nDesign B 300",
    },
    specs: {
      spec_selections: {
        DESIGN_LIST: "Design A 300\nDesign B 300",
      },
      spec_display: [
        {
          key: "DESIGN_LIST",
          label: "Design list",
          value: "Design A 300\nDesign B 300",
        },
      ],
      production_notes: "Rush\nDesign A 300\nDesign B 300",
    },
  });

  assert.equal(
    rows.some((row) => row.label.trim().toLowerCase() === "design list"),
    false
  );
});

test("job ticket prefers cardboard dimensions over webhook set size", () => {
  const rows = buildJobTicketSpecRows({
    customFields: [
      field("width", "Width", "number", 1),
      field("height", "Height", "number", 2),
    ],
    fieldValues: {
      width: 3,
      height: 4,
    },
    specs: {
      spec_selections: {
        SET_SIZE: "2.75x5",
      },
      spec_display: [
        {
          key: "SIZE",
          label: "Size",
          value: "2.75x5",
        },
      ],
    },
  });

  assert.ok(rows.some((row) => row.label === "Width" && row.value === "3"));
  assert.ok(rows.some((row) => row.label === "Height" && row.value === "4"));
  assert.equal(
    rows.some((row) => ["set size", "size"].includes(row.label.toLowerCase())),
    false
  );
});
