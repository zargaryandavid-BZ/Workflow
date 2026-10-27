import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countDesignerLoads,
  orderGroupDesignerId,
  pickLeastLoadedDesigner,
  formatDesignerLoadSuffix,
  formatDesignerOptionLabel,
  sortDesignersByLoad,
} from "./designer-load.ts";

describe("countDesignerLoads", () => {
  it("counts cards and SKU rows (not qty sums)", () => {
    const designerId = "d1";
    const columnId = "start";
    const orders = [
      {
        column_id: columnId,
        specs: {
          designer_id: designerId,
          skus: [
            { id: "a", name: "A", qty: 1000 },
            { id: "b", name: "B", qty: 500 },
          ],
        },
      },
      {
        column_id: columnId,
        specs: {
          designer_id: designerId,
          skus: [{ id: "c", name: "C", qty: 200 }],
        },
      },
      {
        column_id: columnId,
        specs: {
          designer_id: designerId,
          skus: [
            { id: "d", name: "D", qty: 1 },
            { id: "e", name: "E", qty: 1 },
            { id: "f", name: "F", qty: 1 },
            { id: "g", name: "G", qty: 1 },
            { id: "h", name: "H", qty: 1 },
          ],
        },
      },
    ];

    const counts = countDesignerLoads([designerId], orders, [columnId]);
    assert.deepEqual(counts.get(designerId), { load: 3, skuCount: 8 });
    assert.equal(formatDesignerLoadSuffix(3, 8), "(3)/8");
    assert.equal(formatDesignerOptionLabel("Manny", 3, 8), "Manny (3)/8");
  });
});

describe("sortDesignersByLoad", () => {
  it("orders by cards, then SKUs, then name", () => {
    const sorted = sortDesignersByLoad([
      { name: "Zed", load: 1, skuCount: 9 },
      { name: "Ann", load: 3, skuCount: 2 },
      { name: "Bo", load: 3, skuCount: 8 },
      { name: "Cy", load: 3, skuCount: 8 },
    ]);
    assert.deepEqual(
      sorted.map((d) => d.name),
      ["Bo", "Cy", "Ann", "Zed"]
    );
  });
});

describe("pickLeastLoadedDesigner", () => {
  it("picks the fewest open cards first", () => {
    const loads = new Map([
      ["a", { load: 3, skuCount: 2 }],
      ["b", { load: 1, skuCount: 40 }],
    ]);
    assert.equal(pickLeastLoadedDesigner(["a", "b"], loads), "b");
  });

  it("breaks a card tie by fewer SKU rows, then pool order", () => {
    const loads = new Map([
      ["a", { load: 2, skuCount: 9 }],
      ["b", { load: 2, skuCount: 4 }],
      ["c", { load: 2, skuCount: 4 }],
    ]);
    assert.equal(pickLeastLoadedDesigner(["a", "b", "c"], loads), "b");
  });

  it("treats a designer with no open work as free", () => {
    const loads = new Map([["a", { load: 1, skuCount: 1 }]]);
    assert.equal(pickLeastLoadedDesigner(["a", "z"], loads), "z");
    assert.equal(pickLeastLoadedDesigner([], loads), null);
  });
});

describe("orderGroupDesignerId", () => {
  it("keeps appended lines with the existing cards' designer", () => {
    assert.equal(orderGroupDesignerId([null, " d1 "], ["d2"]), "d1");
  });

  it("shares the first line's designer with lines that have none", () => {
    assert.equal(orderGroupDesignerId([], [null, "d2", "d3"]), "d2");
  });

  it("returns null when no line names a designer", () => {
    assert.equal(orderGroupDesignerId([], [null, undefined, ""]), null);
  });
});
