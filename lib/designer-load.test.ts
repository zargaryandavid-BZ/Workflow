import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countDesignerLoads,
  formatDesignerLoadSuffix,
  formatDesignerOptionLabel,
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
