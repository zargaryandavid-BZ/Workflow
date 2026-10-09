import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boxLineItemTitleFromScan,
  boxLineQuantityFromScan,
  clampBoxLineToTicket,
  remainingTicketQuantity,
} from "./multiitem-box-lookup.ts";

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

  it("keeps the full job-ticket qty (not capped at 999)", () => {
    assert.equal(boxLineQuantityFromScan({ skus: [{ id: "a", name: "x", qty: 20000 }] }), 20000);
  });
});

describe("remainingTicketQuantity", () => {
  it("defaults the next box to leftover job-ticket qty", () => {
    assert.equal(remainingTicketQuantity(90, 50), 40);
  });

  it("does not go below zero", () => {
    assert.equal(remainingTicketQuantity(90, 90), 0);
  });
});

describe("clampBoxLineToTicket", () => {
  it("fills the remaining job-ticket qty when none is requested", () => {
    const result = clampBoxLineToTicket({ ticketQty: 90, packedElsewhere: 50 });
    assert.deepEqual(result, { quantity: 40, ticketQty: 90, remaining: 40 });
  });

  it("rejects more than the job ticket has left", () => {
    const result = clampBoxLineToTicket({
      requested: 60,
      ticketQty: 90,
      packedElsewhere: 50,
    });
    assert.equal("error" in result, true);
  });

  it("rejects a scan when the job ticket is already fully boxed", () => {
    const result = clampBoxLineToTicket({ ticketQty: 90, packedElsewhere: 90 });
    assert.equal("error" in result && result.error.includes("90 of 90"), true);
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
