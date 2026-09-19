import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateFulfillmentBoxSlipPdf } from "./fulfillment-box-slip-pdf.ts";

describe("generateFulfillmentBoxSlipPdf", () => {
  it("builds a PDF listing box items, delivery date, and box-id QR", async () => {
    const pdf = await generateFulfillmentBoxSlipPdf({
      boxId: "11111111-2222-3333-4444-555555555555",
      boxLabel: "180926_1",
      deliveryDate: "Sep 18, 2026",
      items: [
        { orderNumber: "15118-2", qty: 16 },
        { orderNumber: "15120-1", qty: 250 },
      ],
    });
    assert.ok(pdf.length > 200);
    assert.equal(pdf.subarray(0, 5).toString("utf8"), "%PDF-");
  });

  it("embeds a card picture when image bytes are provided", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const pdf = await generateFulfillmentBoxSlipPdf({
      boxId: "11111111-2222-3333-4444-555555555555",
      boxLabel: "180926_1",
      deliveryDate: "Sep 18, 2026",
      items: [{ orderNumber: "15118-2", qty: 16, image: png }],
    });
    assert.ok(pdf.length > 200);
    assert.equal(pdf.subarray(0, 5).toString("utf8"), "%PDF-");
  });
});
