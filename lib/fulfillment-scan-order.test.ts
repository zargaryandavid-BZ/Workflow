import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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
