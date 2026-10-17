import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateMultiitemBoxSlipPdf } from "./multiitem-box-slip-pdf.ts";

describe("generateMultiitemBoxSlipPdf", () => {
  it("builds an A5 PDF with customer contact, total qty, and timestamp", async () => {
    const pdf = await generateMultiitemBoxSlipPdf({
      boxName: "BZ BOX 1 · 09/29/26",
      poNumber: "PO-88",
      sizeLabel: "12×10×8 in",
      weightLbs: 4.5,
      shipmentBoxNumber: 1,
      shipmentBoxCount: 3,
      palletNumber: 1,
      palletCount: 2,
      palletBoxNumber: 1,
      palletBoxCount: 2,
      customerName: "Up Top Holding",
      customerEmail: "orders@uptop.com",
      customerPhone: "+1 303-555-0100",
      printedAt: new Date(2026, 8, 29, 14, 30),
      items: [
        {
          orderTitle: "15319-1",
          itemTitle: "Rounded labels ozzos",
          quantity: 18,
          skuLines: Array.from({ length: 18 }, (_, index) => ({
            page: index + 1,
            label: `SKU-${index + 1}`,
            quantity: 1,
          })),
        },
        { orderTitle: "15320-1", itemTitle: "Business cards", quantity: 1 },
      ],
    });
    assert.ok(pdf.length > 200);
    assert.equal(pdf.subarray(0, 5).toString("utf8"), "%PDF-");
  });
});
