import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isApprovalClockColumn,
  isWaitingApprovalColumn,
} from "./waiting-approval-column.ts";

describe("isWaitingApprovalColumn", () => {
  it("matches approval kind", () => {
    assert.equal(
      isWaitingApprovalColumn({ kind: "approval", name: "Client review" }),
      true
    );
  });

  it("matches Waiting Approval by name", () => {
    assert.equal(
      isWaitingApprovalColumn({
        kind: "normal",
        name: "Waiting Approval",
      }),
      true
    );
  });

  it("does not match production columns", () => {
    assert.equal(
      isWaitingApprovalColumn({ kind: "normal", name: "In Progress" }),
      false
    );
  });
});

describe("isApprovalClockColumn", () => {
  it("covers the design stages before approval", () => {
    for (const name of [
      "Start (Create Order)",
      "Missing Info / Changes",
      "Customer Replied",
      "Waiting Approval",
    ]) {
      assert.equal(isApprovalClockColumn({ kind: "normal", name }), true, name);
    }
  });
  it("leaves Hold and production columns out", () => {
    for (const name of ["Hold", "Ready for Prod", "In Production", "Prepress"]) {
      assert.equal(isApprovalClockColumn({ kind: "normal", name }), false, name);
    }
  });
});

