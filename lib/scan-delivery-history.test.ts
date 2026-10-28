import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bucketDeliveries,
  deliveryPeriodKey,
  deliveryPeriodKeys,
} from "./scan-delivery-history.ts";

describe("deliveryPeriodKey", () => {
  it("uses the local day, Monday week start, and month", () => {
    const wed = new Date(2026, 9, 28, 15);
    assert.equal(deliveryPeriodKey(wed, "day"), "2026-10-28");
    assert.equal(deliveryPeriodKey(wed, "week"), "2026-10-26");
    assert.equal(deliveryPeriodKey(new Date(2026, 10, 1, 9), "week"), "2026-10-26");
    assert.equal(deliveryPeriodKey(wed, "month"), "2026-10");
  });
});

describe("deliveryPeriodKeys", () => {
  it("lists the last N periods, oldest first", () => {
    const end = new Date(2026, 2, 2);
    assert.deepEqual(deliveryPeriodKeys(end, "day", 3), [
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
    assert.deepEqual(deliveryPeriodKeys(end, "week", 2), [
      "2026-02-23",
      "2026-03-02",
    ]);
    assert.deepEqual(deliveryPeriodKeys(new Date(2026, 0, 31), "month", 3), [
      "2025-11",
      "2025-12",
      "2026-01",
    ]);
  });
});

describe("bucketDeliveries", () => {
  const keyOf = (iso: string) => iso.slice(0, 7);
  const events = [
    { orderId: "a", columnId: "done", at: "2026-10-01T10:00:00Z" },
    { orderId: "a", columnId: "shipped", at: "2026-10-03T10:00:00Z" },
    { orderId: "b", columnId: "shipped", at: "2026-10-02T12:00:00Z" },
    { orderId: "c", columnId: "shipped", at: "2026-11-02T09:00:00Z" },
    { orderId: "d", columnId: "done", at: "2026-08-01T09:00:00Z" },
  ];
  const itemsByOrder = { a: 5000, b: 250, c: 9, d: 1 };
  const base = {
    events,
    itemsByOrder,
    keys: ["2026-10", "2026-11"],
    period: "month" as const,
    keyOf,
  };

  it("counts an order once per period across columns", () => {
    const buckets = bucketDeliveries({ ...base, metric: "orders" });
    assert.deepEqual(
      buckets.map((b) => [b.key, b.value]),
      [
        ["2026-10", 2],
        ["2026-11", 1],
      ]
    );
    assert.deepEqual(
      buckets[0].lines.map((l) => [l.orderId, l.columnId]),
      [
        ["a", "shipped"],
        ["b", "shipped"],
      ]
    );
  });

  it("sums item quantities: 2 orders can be 5,250 items", () => {
    const buckets = bucketDeliveries({ ...base, metric: "items" });
    assert.equal(buckets[0].value, 5250);
  });

  it("filters to one column", () => {
    const buckets = bucketDeliveries({
      ...base,
      metric: "orders",
      columnId: "done",
    });
    assert.deepEqual(
      buckets.map((b) => b.value),
      [1, 0]
    );
  });
});
