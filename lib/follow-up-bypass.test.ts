import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isFollowUpBypassTarget } from "./follow-up-bypass.ts";

describe("isFollowUpBypassTarget", () => {
  it("allows the approval and missing-info follow-up columns", () => {
    assert.equal(isFollowUpBypassTarget({ kind: "done", name: "Ready for Prod" }), true);
    assert.equal(
      isFollowUpBypassTarget({ kind: "exception", name: "Missing Info / Changes" }),
      true
    );
    assert.equal(isFollowUpBypassTarget({ kind: "normal", name: "In Progress" }), true);
  });

  it("refuses any other column, including Finished", () => {
    assert.equal(isFollowUpBypassTarget({ kind: "normal", name: "Shipped Customer" }), false);
    assert.equal(
      isFollowUpBypassTarget({ kind: "normal", name: "Finished: Review Request" }),
      false
    );
    assert.equal(isFollowUpBypassTarget({ kind: "done", name: "Finished" }), false);
  });
});
