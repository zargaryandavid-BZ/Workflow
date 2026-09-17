import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isWaitingApprovalColumn } from "./waiting-approval-column.ts";

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
