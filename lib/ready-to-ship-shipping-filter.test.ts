import assert from "node:assert/strict";
import { test } from "node:test";
import {
  orderMatchesReadyToShipShippingFilter,
  shouldAutoMoveReadyToShipSign,
} from "./ready-to-ship-shipping-filter.ts";

function sign(kind: string): { kind: string } {
  return { kind };
}

test("RTS shipping filter: Pickup", () => {
  assert.equal(
    orderMatchesReadyToShipShippingFilter(sign("pickup"), "pickup"),
    true
  );
  assert.equal(
    orderMatchesReadyToShipShippingFilter(sign("delivery"), "pickup"),
    false
  );
});

test("RTS shipping filter: FedEx includes shop delivery and printed labels", () => {
  assert.equal(
    orderMatchesReadyToShipShippingFilter(sign("delivery"), "fedex"),
    true
  );
  assert.equal(
    orderMatchesReadyToShipShippingFilter(sign("label_ready"), "fedex"),
    true
  );
  assert.equal(
    orderMatchesReadyToShipShippingFilter(sign("client_fedex"), "fedex"),
    false
  );
});

test("RTS shipping filter: Self FedEx", () => {
  assert.equal(
    orderMatchesReadyToShipShippingFilter(sign("client_fedex"), "self_fedex"),
    true
  );
  assert.equal(
    orderMatchesReadyToShipShippingFilter(sign("delivery"), "self_fedex"),
    false
  );
});

test("RTS shipping filter: Awaiting excludes not-sent and includes pending checkout", () => {
  assert.equal(orderMatchesReadyToShipShippingFilter(null, "awaiting"), false);
  assert.equal(
    orderMatchesReadyToShipShippingFilter(sign("awaiting"), "awaiting"),
    true
  );
  assert.equal(
    orderMatchesReadyToShipShippingFilter(sign("payment_pending"), "awaiting"),
    true
  );
  assert.equal(
    orderMatchesReadyToShipShippingFilter(sign("pickup"), "awaiting"),
    false
  );
});

test("RTS recovery does not auto-move staff-selected pickup", () => {
  assert.equal(shouldAutoMoveReadyToShipSign(sign("pickup")), false);
  assert.equal(shouldAutoMoveReadyToShipSign(sign("delivery")), true);
});
