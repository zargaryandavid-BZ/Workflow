import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatCustomBoxSize } from "./box-size-presets.ts";
import {
  generateThermalBoxSlipPdf,
  thermalBoxBannerLabel,
  thermalBoxDetailLabels,
  thermalInBoxQtyLabel,
} from "./packing-slip-thermal-pdf.ts";

function pageCount(pdf: Buffer): number {
  return pdf.toString("latin1").match(/\/Type \/Page(?!s)/g)?.length ?? 0;
}

const skus = Array.from({ length: 8 }, (_, index) => ({
  id: `sku-${index + 1}`,
  name: `SKU ${index + 1}`,
}));

describe("generateThermalBoxSlipPdf", () => {
  it("formats custom box dimensions for the printed header", () => {
    assert.equal(formatCustomBoxSize("10", "8.5", "6"), "10×8.5×6 in");
    assert.equal(formatCustomBoxSize("10", "", "6"), "");
  });

  it("prints each box size and weight in its header", () => {
    const box = {
      boxNumber: 2,
      sizeLabel: "10×8×6 in",
      weightLbs: 12.5,
      lines: [],
    };
    assert.equal(
      thermalBoxBannerLabel(box, 5, 1, 1),
      "PACKING SLIP  ·  BOX 2 OF 5"
    );
    assert.deepEqual(thermalBoxDetailLabels(box), {
      size: "10×8×6 in",
      weight: "12.5 lb",
    });
  });

  it("prints one 4x6 page per box and continues a full box", async () => {
    const pdf = await generateThermalBoxSlipPdf({
      orderLabel: "15319-1 (2)",
      customerName: "Up Top Holding",
      skus,
      layout: "multiple",
      boxes: [
        {
          boxNumber: 1,
          lines: skus.map((sku) => ({ skuId: sku.id, qty: 100 })),
        },
        {
          boxNumber: 2,
          lines: [{ skuId: "sku-1", qty: 50 }],
        },
      ],
    });
    assert.equal(pdf.subarray(0, 5).toString("utf8"), "%PDF-");
    assert.match(pdf.toString("latin1"), /MediaBox \[0 0 288 432\]/);
    assert.equal(pageCount(pdf), 3);
  });

  it("prints one 4x6 page per SKU placement", async () => {
    const pdf = await generateThermalBoxSlipPdf({
      orderLabel: "15319-1",
      customerName: "Up Top Holding",
      skus,
      layout: "one_per_slip",
      boxes: [
        {
          boxNumber: 1,
          lines: [
            { skuId: "sku-1", qty: 2000 },
            { skuId: "sku-2", qty: 1200 },
          ],
        },
      ],
    });
    assert.equal(pageCount(pdf), 2);
  });

  it("prints the spec quantity and the amount in the box", async () => {
    assert.equal(thermalInBoxQtyLabel(1735, 5205), "From 5,205 / 1,735 In box");
    assert.equal(thermalInBoxQtyLabel(110, 100), "From 100 / 110 In box");
    assert.equal(thermalInBoxQtyLabel(1735), "1,735");
    const pdf = await generateThermalBoxSlipPdf({
      orderLabel: "15441-1 (1)",
      customerName: "Mile High Cure",
      skus: [{ id: "sku-1", name: "Postcards" }],
      layout: "multiple",
      boxes: [
        {
          boxNumber: 1,
          lines: [{ skuId: "sku-1", qty: 1735, fromQty: 5205 }],
        },
      ],
    });
    assert.equal(pdf.subarray(0, 5).toString("utf8"), "%PDF-");
    assert.equal(pageCount(pdf), 1);
  });
});
