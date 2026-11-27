import test from "node:test";
import assert from "node:assert/strict";
import { pickDefaultPickupLocation, isBoydPickupLocation } from "./pickup-locations.ts";

const boyd = { id: "b", name: "306 Boyd St", street: "306 Boyd St" };
const main = { id: "m", name: "1025 E 16th St,", street: "1025 E 16th St" };

test("default pickup is 1025 E 16th St unless scanned at Boyd", () => {
  assert.equal(pickDefaultPickupLocation([boyd, main], false)?.id, "m");
  assert.equal(pickDefaultPickupLocation([boyd, main], true)?.id, "b");
  assert.equal(pickDefaultPickupLocation([main, boyd], true)?.id, "b");
});

test("single-address tenants keep their only address", () => {
  assert.equal(pickDefaultPickupLocation([boyd], false)?.id, "b");
  assert.equal(pickDefaultPickupLocation([main], true)?.id, "m");
  assert.equal(pickDefaultPickupLocation([], true), null);
});

test("Boyd detection uses name, street or address line", () => {
  assert.equal(isBoydPickupLocation({ addressLine: "306 Boyd St, Los Angeles" }), true);
  assert.equal(isBoydPickupLocation(main), false);
});
