import assert from "node:assert/strict";
import test from "node:test";
import {
  ensurePickupCodeInMessage,
  formatPickupCode,
  normalizePickupCode,
  pickupCodeFromSpecs,
  PICKUP_CODE_PREVIEW,
} from "./pickup-code.ts";
import { checkPickupCode, pickupConfirmationFromSpecs } from "./fulfillment-pickup.ts";
import { DEFAULT_MESSAGE_TEMPLATES, renderMessageTemplate } from "./message-templates.ts";
import { generatePickupReceiptPdf, pickupReceiptFileName } from "./pickup-receipt-pdf.ts";

test("normalizePickupCode keeps exactly 8 digits", () => {
  assert.equal(normalizePickupCode("1234 5678"), "12345678");
  assert.equal(normalizePickupCode("1234-5678"), "12345678");
  assert.equal(normalizePickupCode(12345678), "12345678");
  assert.equal(normalizePickupCode("1234567"), null);
  assert.equal(normalizePickupCode("123456789"), null);
  assert.equal(normalizePickupCode("abcd5678"), null);
  assert.equal(normalizePickupCode(null), null);
  assert.equal(pickupCodeFromSpecs({ pickup_code: "87654321" }), "87654321");
  assert.equal(pickupCodeFromSpecs({}), null);
  assert.equal(formatPickupCode("12345678"), "1234 5678");
});

test("checkPickupCode", () => {
  assert.equal(checkPickupCode(null, ""), "not_required");
  assert.equal(checkPickupCode("12345678", ""), "missing");
  assert.equal(checkPickupCode("12345678", "1234 5678"), "ok");
  assert.equal(checkPickupCode("12345678", "12345679"), "wrong");
});

test("ensurePickupCodeInMessage swaps the preview and appends when missing", () => {
  assert.equal(
    ensurePickupCodeInMessage(`Code: ${PICKUP_CODE_PREVIEW}`, "12345678"),
    "Code: 1234 5678"
  );
  assert.equal(
    ensurePickupCodeInMessage("Ready for pickup.", "12345678"),
    "Ready for pickup.\n\nPickup code: 1234 5678"
  );
  assert.equal(
    ensurePickupCodeInMessage("Ready. Code 12345678", "12345678"),
    "Ready. Code 12345678"
  );
  assert.equal(
    ensurePickupCodeInMessage(`Code: ${PICKUP_CODE_PREVIEW}`, null),
    "Code:"
  );
});

test("default pickup-ready SMS carries the code", () => {
  const sms = renderMessageTemplate(DEFAULT_MESSAGE_TEMPLATES.pickup_ready_sms, {
    order_number: "15433-3",
    pickup_location: "Shop",
    pickup_hours: "",
    pickup_code: "1234 5678",
    portal_url: "https://x.test/s",
  });
  assert.match(sms, /Pickup code: 1234 5678\./);
  assert.match(DEFAULT_MESSAGE_TEMPLATES.pickup_ready_email_body, /\{\{pickup_code\}\}/);
});

test("pickupConfirmationFromSpecs reads saved confirmations only", () => {
  assert.equal(pickupConfirmationFromSpecs({}), null);
  assert.equal(pickupConfirmationFromSpecs({ pickup_confirmation: "x" }), null);
  const saved = pickupConfirmationFromSpecs({
    pickup_confirmation: {
      first_name: "Dana",
      last_name: "Smith",
      picked_up_at: "2026-11-05T19:00:00.000Z",
      signature_path: "t/o/pickup/a.png",
    },
  });
  assert.equal(saved?.first_name, "Dana");
});

test("pickup receipt PDF renders with the signature", async () => {
  // 1×1 white PNG
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
    "base64"
  );
  const pdf = await generatePickupReceiptPdf({
    shopName: "Bazaar Printing",
    orderNumbers: ["15433-1", "15433-2"],
    pickedUpBy: "Dana Smith",
    pickedUpAt: "Nov 5, 2026, 11:01 AM",
    codeLast4: "5678",
    signaturePng: png,
  });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length < 60_000, `PDF should stay small, got ${pdf.length}`);
  assert.equal(pickupReceiptFileName("15433-3"), "Pickup signature 15433-3.pdf");
});
