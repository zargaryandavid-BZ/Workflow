import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DUE_STAFF_EDITED_AT_KEY,
  DUE_STAFF_EDITED_BY_KEY,
  activityShowsStaffDue,
  applyStaffDueEdit,
  needsLegacyStaffCheck,
  preserveDueSyncKeys,
  resolveInboundDueResync,
} from "./due-resync.ts";

const NOW = new Date("2026-10-21T07:21:59.000Z");
const stamped = { [DUE_STAFF_EDITED_AT_KEY]: NOW.toISOString() };

describe("resolveInboundDueResync", () => {
  it("BZ-418: re-sync with no date never clears a staff date", () => {
    const d = resolveInboundDueResync({
      existingDueDate: "2026-10-23",
      existingSpecs: stamped,
      inboundDueDate: null,
    });
    assert.deepEqual(d, { action: "keep", reason: "inbound_empty", dueDate: "2026-10-23" });
  });
  it("re-sync with no date never clears a source / approval-move date either", () => {
    const d = resolveInboundDueResync({
      existingDueDate: "2026-08-19",
      existingSpecs: {},
      inboundDueDate: "",
    });
    assert.equal(d.action, "keep");
  });
  it("staff-stamped date beats a different inbound date", () => {
    const d = resolveInboundDueResync({
      existingDueDate: "2026-10-23",
      existingSpecs: stamped,
      inboundDueDate: "2026-10-27",
    });
    assert.deepEqual(d, { action: "keep", reason: "staff_set", dueDate: "2026-10-23" });
  });
  it("legacy (pre-stamp) staff date beats a different inbound date", () => {
    const d = resolveInboundDueResync({
      existingDueDate: "2026-10-23",
      existingSpecs: {},
      inboundDueDate: "2026-10-27",
      legacyStaffSet: true,
    });
    assert.equal(d.action, "keep");
  });
  it("source-set date is updated by a new source date (unchanged behavior)", () => {
    const d = resolveInboundDueResync({
      existingDueDate: "2026-10-23",
      existingSpecs: {},
      inboundDueDate: "2026-10-27",
    });
    assert.deepEqual(d, { action: "apply", dueDate: "2026-10-27" });
  });
  it("card without a date takes the inbound date (or stays empty)", () => {
    assert.deepEqual(
      resolveInboundDueResync({ existingDueDate: null, existingSpecs: stamped, inboundDueDate: "2026-10-27" }),
      { action: "apply", dueDate: "2026-10-27" }
    );
    assert.deepEqual(
      resolveInboundDueResync({ existingDueDate: null, existingSpecs: {}, inboundDueDate: null }),
      { action: "apply", dueDate: null }
    );
  });
});

describe("needsLegacyStaffCheck", () => {
  it("only when a non-stamped date would be replaced by a different one", () => {
    assert.equal(needsLegacyStaffCheck({ existingDueDate: "2026-10-23", existingSpecs: {}, inboundDueDate: "2026-10-27" }), true);
    assert.equal(needsLegacyStaffCheck({ existingDueDate: "2026-10-23", existingSpecs: stamped, inboundDueDate: "2026-10-27" }), false);
    assert.equal(needsLegacyStaffCheck({ existingDueDate: "2026-10-23", existingSpecs: {}, inboundDueDate: null }), false);
    assert.equal(needsLegacyStaffCheck({ existingDueDate: "2026-10-23", existingSpecs: {}, inboundDueDate: "2026-10-23" }), false);
  });
});

describe("activityShowsStaffDue", () => {
  const row = (actor: string | null, to: string | null) => ({
    actor,
    metadata: { changes: [{ field: "Due date", from: null, to }] },
  });
  it("newest Due date change by a person that set the current value", () => {
    assert.equal(activityShowsStaffDue([row("u1", "2026-10-23"), row("u1", "2026-10-22")], "2026-10-23"), true);
  });
  it("ignores unrelated rows before the Due date change", () => {
    const other = { actor: "u1", metadata: { changes: [{ field: "Designer", to: "X" }] } };
    assert.equal(activityShowsStaffDue([other, row("u1", "2026-10-23")], "2026-10-23"), true);
  });
  it("false when the newest due change was a sync (no actor) or a different value", () => {
    assert.equal(activityShowsStaffDue([row(null, "2026-10-23")], "2026-10-23"), false);
    assert.equal(activityShowsStaffDue([row("u1", "2026-10-22")], "2026-10-23"), false);
    assert.equal(activityShowsStaffDue([], "2026-10-23"), false);
  });
});

describe("applyStaffDueEdit / preserveDueSyncKeys", () => {
  it("stamps on set, clears on clear", () => {
    const set = applyStaffDueEdit({ a: 1 }, "2026-10-23", { userId: "u1", now: NOW });
    assert.equal(set[DUE_STAFF_EDITED_AT_KEY], NOW.toISOString());
    assert.equal(set[DUE_STAFF_EDITED_BY_KEY], "u1");
    const cleared = applyStaffDueEdit(set, null, { userId: "u1", now: NOW });
    assert.equal(DUE_STAFF_EDITED_AT_KEY in cleared, false);
    assert.equal(DUE_STAFF_EDITED_BY_KEY in cleared, false);
    assert.equal(cleared.a, 1);
  });
  it("client cannot forge or drop the stamp", () => {
    assert.deepEqual(preserveDueSyncKeys({}, { [DUE_STAFF_EDITED_AT_KEY]: "x", b: 2 }), { b: 2 });
    assert.deepEqual(preserveDueSyncKeys(stamped, { b: 2 }), { b: 2, ...stamped });
  });
});
