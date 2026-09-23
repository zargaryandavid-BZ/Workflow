import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildScanCardDisplay,
  pickScannedOrder,
  sanitizeScanLookupToken,
} from "./fulfillment-scan-order.ts";

describe("pickScannedOrder", () => {
  const orders = [
    {
      id: "a",
      title: "ORD-2026-15219-1",
      specs: { webhook_order_number: "ORD-2026-15219" },
    },
    { id: "b", title: "123123-1", specs: null },
    {
      id: "c",
      title: "Business Cards",
      specs: { webhook_order_number: "ORD-2026-0467" },
    },
  ];

  it("matches short order numbers, not only exact titles", () => {
    assert.equal(pickScannedOrder(orders, "15219-1")?.id, "a");
    assert.equal(pickScannedOrder(orders, "123123")?.id, "b");
    assert.equal(pickScannedOrder(orders, "467")?.id, "c");
  });

  it("returns null when nothing matches", () => {
    assert.equal(pickScannedOrder(orders, "99999"), null);
  });
});

describe("sanitizeScanLookupToken", () => {
  it("strips PostgREST filter metacharacters", () => {
    assert.equal(sanitizeScanLookupToken("12%3_4(5)"), "12345");
  });
});

describe("buildScanCardDisplay", () => {
  it("reads webhook Quantity/Product keys, not only lowercase specs.quantity", () => {
    const d = buildScanCardDisplay({
      specs: {
        Quantity: 250,
        Product: "Labels",
        Materials: "White vinyl",
        due_date_label: "5 working days after approval",
      },
      dueDate: null,
    });
    assert.equal(d.dueDisplay, "5 working days after approval");
    assert.equal(d.qty, 250);
    assert.ok(d.specLines.some((l) => l.value === "Labels"));
    assert.ok(d.specLines.some((l) => l.value === "White vinyl"));
  });

  it("unwraps catalog {label,value} spec objects", () => {
    const d = buildScanCardDisplay({
      specs: { Product: { label: "Folding carton", value: "fc-1" } },
      dueDate: null,
    });
    assert.ok(d.specLines.some((l) => l.value === "Folding carton"));
  });

  it("prefers custom-field names the same way board cards do", () => {
    const d = buildScanCardDisplay({
      specs: {},
      dueDate: "2026-09-30",
      fieldValuesByName: { Product: "Folding carton" },
    });
    assert.equal(d.dueDisplay, "Sep 30, 2026");
    assert.deepEqual(d.specLines, [
      { label: "Product", value: "Folding carton" },
    ]);
  });

  it("builds a qty-first table from print fields, leftover card fields, and spec_display", () => {
    const d = buildScanCardDisplay({
      specs: {
        Quantity: 5000,
        Category: { label: "Packaging & Boxes", value: "pkg" },
        Width: 4,
        Height: 5,
        spec_display: [{ key: "DIE", label: "Die", value: "Converting" }],
      },
      dueDate: null,
      fieldValuesByName: {
        Product: "Stand Up Pouches",
        Materials: "MET PET",
        Finishing: "Matte Lamination",
        Zipper: "Yes",
      },
    });
    assert.deepEqual(
      d.specLines.map((l) => l.label),
      [
        "Qty",
        "Category",
        "Product",
        "Materials",
        "Finishing",
        "Width",
        "Height",
        "Zipper",
        "Die",
      ]
    );
    assert.equal(d.specLines.find((l) => l.label === "Category")?.value, "Packaging & Boxes");
  });
});
