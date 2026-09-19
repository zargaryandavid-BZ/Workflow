import assert from "node:assert/strict";
import test from "node:test";
import {
  isPngBuffer,
  orderNumberQrPayload,
  orderNumberQrPng,
} from "./order-qr.ts";

test("empty order number has no QR payload", () => {
  assert.equal(orderNumberQrPayload(""), null);
  assert.equal(orderNumberQrPayload("   "), null);
});

test("trims the printed order number as the QR payload", () => {
  assert.equal(orderNumberQrPayload("  683-1  "), "683-1");
});

test("PNG QR starts with a PNG header", async () => {
  const png = await orderNumberQrPng("683-1");
  assert.ok(png);
  assert.equal(isPngBuffer(png!), true);
});

test("empty order number yields no PNG", async () => {
  assert.equal(await orderNumberQrPng(""), null);
});
