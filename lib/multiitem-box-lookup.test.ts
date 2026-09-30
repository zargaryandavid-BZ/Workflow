import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boxLineItemTitleFromScan, boxLineQuantityFromScan } from "./multiitem-box-lookup.ts";

describe("boxLineQuantityFromScan", () => {
  it("sums SKU qtys when no named qty field is set", () => {
    assert.equal(
      boxLineQuantityFromScan({
        skus: [
          { id: "a", name: "4x6", qty: 250 },
          { id: "b", name: "5x7", qty: 250 },
        ],
      }),
      500
    );
  });

  it("uses the order Qty custom field", () => {
    assert.equal(
      boxLineQuantityFromScan({}, { Qty: 12 }),
      12
    );
  });

  it("defaults to 1 when the order has no qty", () => {
    assert.equal(boxLineQuantityFromScan({}), 1);
  });
});

describe("boxLineItemTitleFromScan", () => {
  it("uses the webhook line item title", () => {
    assert.equal(
      boxLineItemTitleFromScan({ webhook_item_title: "Rounded labels ozzos" }),
      "Rounded labels ozzos"
    );
  });

  it("falls back to SKU names", () => {
    assert.equal(
      boxLineItemTitleFromScan({
        skus: [{ id: "a", name: "Rounded labels ozzos", qty: 1 }],
      }),
      "Rounded labels ozzos"
    );
  });
});
