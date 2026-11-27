import test from "node:test";
import assert from "node:assert/strict";
import {
  isPickupColumnName,
  nextPickupReminderState,
  pickupReadySince,
  pickupReminderMessage,
  pickupReminderStep,
  stateForStay,
} from "./pickup-reminders.ts";

const day = (n: number) => new Date(Date.UTC(2026, 10, 1) + n * 86400000);
const since = day(0);

test("pickup columns", () => {
  assert.equal(isPickupColumnName("Pickups "), true);
  assert.equal(isPickupColumnName("🚫📦 Not Picked Up"), true);
  assert.equal(isPickupColumnName("🫡 Ready to Ship"), false);
});

test("reminders on day 3, 7, 14 — only the latest due", () => {
  assert.equal(pickupReminderStep(since, {}, day(2)), null);
  assert.deepEqual(pickupReminderStep(since, {}, day(3)), { kind: "reminder", day: 3 });
  assert.deepEqual(pickupReminderStep(since, {}, day(10)), { kind: "reminder", day: 7 });
  assert.equal(pickupReminderStep(since, { sent_days: [7] }, day(10)), null);
  assert.deepEqual(pickupReminderStep(since, { sent_days: [3, 7] }, day(14)), { kind: "reminder", day: 14 });
});

test("final notice at day 30, then OK to recycle 30 days later", () => {
  const final = pickupReminderStep(since, { sent_days: [14] }, day(30));
  assert.equal(final?.kind, "final");
  const s = nextPickupReminderState({ sent_days: [14] }, final!, day(30));
  assert.equal(pickupReminderStep(since, s, day(45)), null);
  assert.deepEqual(pickupReminderStep(since, s, day(60)), { kind: "recycle" });
  const done = nextPickupReminderState(s, { kind: "recycle" }, day(60));
  assert.equal(pickupReminderStep(since, done, day(90)), null);
});

test("a new stay in pickups starts over", () => {
  const old = { ready_since: day(0).toISOString(), sent_days: [3, 7] };
  assert.deepEqual(stateForStay(old, day(0)), old);
  assert.deepEqual(stateForStay(old, day(20)), { ready_since: day(20).toISOString() });
});

test("ready-since = start of the current stay in pickup columns", () => {
  const p = new Set(["pick", "npu"]);
  const moves = [
    { created_at: day(1).toISOString(), from: "prod", to: "pick" },
    { created_at: day(2).toISOString(), from: "pick", to: "prod" },
    { created_at: day(5).toISOString(), from: "prod", to: "pick" },
    { created_at: day(9).toISOString(), from: "pick", to: "npu" },
  ];
  assert.equal(pickupReadySince(moves, p, null)?.toISOString(), day(5).toISOString());
  assert.equal(pickupReadySince([], p, day(7))?.toISOString(), day(7).toISOString());
});

test("messages carry address, hours and code", () => {
  const m = pickupReminderMessage({ kind: "final", holdUntil: day(60) }, {
    tenantName: "Bazaar Printing",
    orderNumber: "15815",
    pickupLocation: "1025 E 16th St, Los Angeles, CA 90021",
    pickupHours: "Available for pickup: Mon–Fri 8 AM – 3 PM",
    pickupCode: "12345678",
  })!;
  assert.match(m.text, /hold it until/);
  assert.match(m.text, /1025 E 16th St/);
  assert.match(m.text, /Pickup code: 12345678/);
  assert.equal(pickupReminderMessage({ kind: "recycle" }, {
    tenantName: "x", orderNumber: "1", pickupLocation: "", pickupHours: "", pickupCode: null,
  }), null);
});
