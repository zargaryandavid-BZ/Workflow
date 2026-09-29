import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  customerResponseToApprovalResult,
  isApprovalRejection,
  notifyRuleApprovalTarget,
} from "./notify-rule-approval-target.ts";

const WAITING_RULE = {
  to_column: "prepress",
  config: { rejected_to_column: "start" },
};

describe("notifyRuleApprovalTarget", () => {
  it("moves approved proofs to the approve column", () => {
    assert.equal(notifyRuleApprovalTarget(WAITING_RULE, "approved"), "prepress");
  });

  it("treats request-changes as the same move as rejection", () => {
    assert.equal(
      notifyRuleApprovalTarget(WAITING_RULE, "changes_requested"),
      "start"
    );
    assert.equal(isApprovalRejection("changes_requested"), true);
    assert.equal(
      customerResponseToApprovalResult("changes_requested"),
      "rejected"
    );
  });

  it("falls through when leave-in-place is selected", () => {
    assert.equal(
      notifyRuleApprovalTarget({ to_column: "prepress", config: {} }, "rejected"),
      undefined
    );
  });
});
