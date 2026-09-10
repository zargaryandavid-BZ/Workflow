import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { columnStopsWorkTimer } from "./timer-stop-columns.ts";

describe("columnStopsWorkTimer", () => {
  it("does NOT stop in the Start column (timer allowed here)", () => {
    assert.equal(columnStopsWorkTimer({ name: "Start" }), false);
    assert.equal(columnStopsWorkTimer({ name: "START (Order Created)" }), false);
    assert.equal(columnStopsWorkTimer({ name: "Start (Create Order)" }), false);
    assert.equal(columnStopsWorkTimer({ kind: "normal", name: "start" }), false);
  });

  it("stops on In Progress", () => {
    assert.equal(columnStopsWorkTimer({ name: "In Progress" }), true);
  });

  it("stops on Hold / On Hold", () => {
    assert.equal(columnStopsWorkTimer({ name: "Hold" }), true);
    assert.equal(columnStopsWorkTimer({ name: "On Hold" }), true);
  });

  it("stops on Missing Info (any naming)", () => {
    assert.equal(columnStopsWorkTimer({ name: "Missing Info" }), true);
    assert.equal(columnStopsWorkTimer({ name: "Missing Info / Changes" }), true);
    assert.equal(columnStopsWorkTimer({ kind: "exception", name: "Missing Info" }), true);
  });

  it("stops on Customer Replied", () => {
    assert.equal(columnStopsWorkTimer({ name: "Customer Replied" }), true);
  });

  it("stops on approval and done columns", () => {
    assert.equal(columnStopsWorkTimer({ name: "Waiting Approval" }), true);
    assert.equal(
      columnStopsWorkTimer({ kind: "approval", name: "Customer Approval" }),
      true
    );
    assert.equal(columnStopsWorkTimer({ kind: "done", name: "Done" }), true);
  });

  it("stops on any other normal column", () => {
    assert.equal(columnStopsWorkTimer({ kind: "normal", name: "Prepress" }), true);
    assert.equal(columnStopsWorkTimer({ kind: "normal", name: "Outsource" }), true);
  });
});
