import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { columnStopsWorkTimer } from "./timer-stop-columns.ts";

describe("columnStopsWorkTimer", () => {
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

  it("stops on Waiting Approval and approval-kind columns", () => {
    assert.equal(columnStopsWorkTimer({ name: "Waiting Approval" }), true);
    assert.equal(
      columnStopsWorkTimer({ kind: "approval", name: "Customer Approval" }),
      true
    );
  });

  it("does not stop on In Progress or production", () => {
    assert.equal(columnStopsWorkTimer({ name: "In Progress" }), false);
    assert.equal(columnStopsWorkTimer({ kind: "normal", name: "Arsen" }), false);
    assert.equal(columnStopsWorkTimer({ kind: "done", name: "Done" }), false);
  });
});
