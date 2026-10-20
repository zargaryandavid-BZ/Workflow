import assert from "node:assert/strict";
import test from "node:test";
import {
  decodePickupSignaturePng,
  formatPickupDateTime,
  pickupRecipientName,
} from "./fulfillment-pickup.ts";
import {
  DEFAULT_MESSAGE_TEMPLATES,
  renderMessageTemplate,
} from "./message-templates.ts";

test("decodePickupSignaturePng accepts PNG signatures only", () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  const decoded = decodePickupSignaturePng(
    `data:image/png;base64,${png.toString("base64")}`
  );
  assert.deepEqual(decoded, png);
  assert.equal(
    decodePickupSignaturePng(
      `data:image/png;base64,${Buffer.from("not png").toString("base64")}`
    ),
    null
  );
  assert.equal(decodePickupSignaturePng("data:image/jpeg;base64,AA=="), null);
});

test("pickup notice names who signed and when", () => {
  const when = formatPickupDateTime("2026-10-19T17:36:00.000Z");
  assert.equal(pickupRecipientName(" Dana ", "Smith"), "Dana Smith");
  assert.match(when, /Oct 19, 2026/);
  assert.equal(
    renderMessageTemplate(DEFAULT_MESSAGE_TEMPLATES.order_picked_up_sms, {
      customer_name: "Diana",
      order_number: "15472-1",
      picked_up_by: "Dana Smith",
      picked_up_at: when,
      brand: "Bazaar Printing",
    }),
    `Hi Diana, this is Bazaar Printing. Order 15472-1 was picked up by Dana Smith on ${when}.`
  );
});
