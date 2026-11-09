import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boxRangeLabel, summarySlipRows } from "./packing-slip-summary-pdf.ts";

describe("summarySlipRows", () => {
  const skus = [
    { id: "a", name: "Blue Razz", number: 1 },
    { id: "__pdf_page_1__", name: "Blue Razz", number: 1 },
    { id: "b", name: "Mango", number: 2 },
  ];
  it("totals shipped per SKU, merges alias ids, keeps ordered from box lines", () => {
    const rows = summarySlipRows(skus, [
      { boxNumber: 1, lines: [{ skuId: "a", qty: 1000, fromQty: 2500 }, { skuId: "b", qty: 480, fromQty: 500 }] },
      { boxNumber: 2, lines: [{ skuId: "__pdf_page_1__", qty: 1500, fromQty: 2500 }] },
    ]);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => [r.name, r.ordered, r.shipped, r.remaining, r.boxes]),
      [
        ["Blue Razz", 2500, 2500, 0, [1, 2]],
        ["Mango", 500, 480, 20, [1]],
      ]
    );
  });
  it("lists a SKU with nothing boxed as 0 shipped", () => {
    const rows = summarySlipRows(skus, [{ boxNumber: 1, lines: [{ skuId: "a", qty: 5 }] }], { b: 100 });
    assert.equal(rows[1]!.shipped, 0);
    assert.equal(rows[1]!.remaining, 100);
  });
});

describe("boxRangeLabel", () => {
  it("collapses runs", () => {
    assert.equal(boxRangeLabel([1, 2, 3, 5]), "1–3, 5");
    assert.equal(boxRangeLabel([]), "—");
  });
});
