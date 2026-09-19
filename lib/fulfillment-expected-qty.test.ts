import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fulfillmentDisplayQty,
  fulfillmentExpectedQty,
} from "./fulfillment-expected-qty.ts";

describe("fulfillmentExpectedQty", () => {
  it("sums sku.qty (board field), not sku.quantity", () => {
    assert.equal(
      fulfillmentExpectedQty({ skus: [{ qty: 250 }, { qty: 10 }] }),
      260
    );
  });

  it("falls back to sku.quantity when qty is missing", () => {
    assert.equal(fulfillmentExpectedQty({ skus: [{ quantity: 80 }] }), 80);
  });

  it("uses print order_qty when SKUs have no qty", () => {
    assert.equal(fulfillmentExpectedQty({ order_qty: 500, skus: [{}] }), 500);
  });

  it("defaults to 1 when nothing is set", () => {
    assert.equal(fulfillmentExpectedQty(null), 1);
    assert.equal(fulfillmentExpectedQty({ skus: [] }), 1);
  });
});

describe("fulfillmentDisplayQty", () => {
  it("treats stored 0 as missing so the real SKU qty shows", () => {
    assert.equal(
      fulfillmentDisplayQty(0, { skus: [{ qty: 250 }] }),
      250
    );
  });

  it("keeps a positive stored qty after staff edit", () => {
    assert.equal(fulfillmentDisplayQty(12, { skus: [{ qty: 250 }] }), 12);
  });
});
