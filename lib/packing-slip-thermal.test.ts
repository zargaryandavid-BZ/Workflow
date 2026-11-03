import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPresetDimensions,
  formatCustomBoxSize,
  presetBoxDimensions,
  resizeBoxDrafts,
} from "./box-size-presets.ts";
import {
  generateThermalBoxSlipPdf,
  palletSlipRows,
  thermalBoxBannerLabel,
  thermalBoxDetailLabels,
  thermalInBoxQtyLabel,
  thermalRowLayout,
  THERMAL_ROWS,
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
    assert.deepEqual(presetBoxDimensions("18×12×12 in"), {
      length: "18",
      width: "12",
      height: "12",
    });
    assert.equal(presetBoxDimensions("Custom"), null);
    assert.deepEqual(
      applyPresetDimensions(
        [{ length: "", width: "", height: "", weight: "4" }],
        "18×12×12 in"
      ),
      [{ length: "18", width: "12", height: "12", weight: "4" }]
    );
    assert.deepEqual(
      resizeBoxDrafts(
        [{ length: "18", width: "12", height: "12", weight: "4" }],
        2,
        "18×12×12 in"
      ),
      [
        { length: "18", width: "12", height: "12", weight: "4" },
        { length: "18", width: "12", height: "12", weight: "4" },
      ]
    );
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
      "PACKING BOX SLIP  ·  BOX 2 OF 5"
    );
    assert.deepEqual(thermalBoxDetailLabels(box), {
      size: "10×8×6 in",
      weight: "12.5 lb",
    });
  });

  it("prints one 4x6 page per box", async () => {
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
    // Box 1's 8 SKUs fit on one slip (up to 10), 1 for box 2. Pallet slip stays off unless asked.
    assert.equal(pageCount(pdf), 2);
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
    // 1 box → pallet slip off by default: 2 SKU pages only.
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
    // 1 box → no pallet slip by default.
    assert.equal(pageCount(pdf), 1);
  });

  it("adds the pallet slip only when asked", async () => {
    const oneBox = [{ boxNumber: 1, lines: [{ skuId: "sku-1", qty: 5 }] }];
    const twoBoxes = [
      ...oneBox,
      { boxNumber: 2, lines: [{ skuId: "sku-2", qty: 5 }] },
    ];
    const base = { orderLabel: "1-1", customerName: "", skus, layout: "multiple" as const };
    assert.equal(pageCount(await generateThermalBoxSlipPdf({ ...base, boxes: oneBox })), 1);
    assert.equal(
      pageCount(await generateThermalBoxSlipPdf({ ...base, boxes: oneBox, palletSlip: true })),
      2
    );
    assert.equal(pageCount(await generateThermalBoxSlipPdf({ ...base, boxes: twoBoxes })), 2);
    assert.equal(
      pageCount(await generateThermalBoxSlipPdf({ ...base, boxes: twoBoxes, palletSlip: true })),
      3
    );
  });

  it("uses the SKU's own number, not its list position", () => {
    const rows = palletSlipRows(
      [
        { id: "a", name: "A", number: 1 },
        { id: "__pdf_page_1__", name: "A", number: 1 },
        { id: "b", name: "B", number: 2 },
      ],
      [{ boxNumber: 1, lines: [{ skuId: "b", qty: 3 }] }]
    );
    assert.equal(rows[0].itemNumber, 2);
  });

  it("lists every SKU in every box on the pallet slip", () => {
    const rows = palletSlipRows(skus, [
      { boxNumber: 1, lines: [{ skuId: "sku-2", qty: 10 }, { skuId: "sku-1", qty: 5 }] },
      { boxNumber: 2, lines: [{ skuId: "sku-1", qty: 7 }, { skuId: "sku-2", qty: 0 }] },
    ]);
    assert.deepEqual(
      rows.map((r) => [r.itemNumber, r.qty, r.boxNumber]),
      [
        [1, 5, 1],
        [2, 10, 1],
        [1, 7, 2],
      ]
    );
  });
});

describe("box slip SKU rows", () => {
  const skus = Array.from({ length: 11 }, (_, i) => ({
    id: `sku-${i + 1}`,
    name: `Design ${i + 1}`,
    imageUrl: null,
  }));
  const boxWith = (count: number) => [
    {
      boxNumber: 1,
      lines: skus.slice(0, count).map((sku) => ({ skuId: sku.id, qty: 65 })),
    },
  ];

  it("fits up to 10 SKUs on one slip", async () => {
    assert.equal(THERMAL_ROWS, 10);
    const pdf = await generateThermalBoxSlipPdf({
      orderLabel: "BZ-481",
      customerName: "Test",
      skus,
      boxes: boxWith(10),
      layout: "multiple",
      palletSlip: false,
    });
    assert.equal(pageCount(pdf), 1);
  });

  it("starts a second slip at the 11th SKU", async () => {
    const pdf = await generateThermalBoxSlipPdf({
      orderLabel: "BZ-481",
      customerName: "Test",
      skus,
      boxes: boxWith(11),
      layout: "multiple",
      palletSlip: false,
    });
    assert.equal(pageCount(pdf), 2);
  });

  it("keeps every row on the 4x6 label", () => {
    for (const count of [1, 6, 7, 10]) {
      const row = thermalRowLayout(count);
      assert.ok(94 + (count - 1) * row.pitch + row.rowH <= 426, `count ${count}`);
    }
  });
});
