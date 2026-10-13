import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { productionOrderDetails } from "./fulfillment-production-details.ts";

describe("productionOrderDetails", () => {
  it("expands an aggregate quantity across the configured SKU count", () => {
    const details = productionOrderDetails(
      {
        sku_qty: 5,
        skus: [
          {
            id: "sku",
            name: "Roll Labels – White BOPP – Matte Lamination",
            qty: 10_500,
          },
        ],
      },
      "Item",
      ["one.jpg", "two.jpg"],
      5
    );

    assert.equal(details.product_type, "Roll Labels");
    assert.equal(details.sku_count, 5);
    assert.equal(details.total_qty, 10_500);
    assert.deepEqual(
      details.sku_details.map((sku) => sku.quantity),
      [2100, 2100, 2100, 2100, 2100]
    );
    assert.equal(details.sku_details[0].artwork_url, "one.jpg");
    assert.equal(details.sku_details[2].artwork_url, null);
  });

  it("uses the Final Production PDF count instead of extra artwork thumbnails", () => {
    const details = productionOrderDetails(
      {
        skus: [{ id: "sku", name: "Brochures – Matte", qty: 1000 }],
      },
      "Brochures",
      Array.from({ length: 13 }, (_, index) => `${index}.jpg`),
      5
    );

    assert.equal(details.sku_count, 5);
    assert.equal(details.sku_details.length, 5);
    assert.equal(details.sku_details[0].quantity, 200);
  });

  it("prefers saved SKU Qty when a double-sided PDF has more pages", () => {
    const details = productionOrderDetails(
      {
        sku_qty: 2,
        skus: [{ id: "sku", name: "Brochures – Matte", qty: 1000 }],
      },
      "Brochures",
      ["front-1.jpg", "back-1.jpg", "front-2.jpg", "back-2.jpg"],
      4
    );

    assert.equal(details.sku_count, 2);
    assert.equal(details.sku_details[0].quantity, 500);
  });

  it("keeps explicit quantities when each SKU has its own row", () => {
    const details = productionOrderDetails(
      {
        skus: [
          { id: "a", name: "SKU 1", qty: 125 },
          { id: "b", name: "SKU 2", qty: 250 },
        ],
      },
      "Brochures",
      []
    );

    assert.equal(details.sku_count, 2);
    assert.equal(details.total_qty, 375);
    assert.deepEqual(
      details.sku_details.map((sku) => sku.quantity),
      [125, 250]
    );
  });

  it("does not invent per-SKU quantities when the total cannot divide evenly", () => {
    const details = productionOrderDetails(
      {
        sku_qty: 3,
        skus: [{ id: "sku", name: "Pouches – Matte", qty: 100 }],
      },
      "Pouches",
      []
    );

    assert.deepEqual(
      details.sku_details.map((sku) => sku.quantity),
      [null, null, null]
    );
  });
});
