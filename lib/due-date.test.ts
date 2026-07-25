import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addWorkingDays,
  formatOrderDueDisplay,
  formatPendingDueChipLabel,
  isPendingAfterApprovalDue,
  materializeAfterApprovalDue,
  recomputeDueFromProcessingDays,
  resolveWebhookDue,
} from "./due-date.ts";

describe("addWorkingDays", () => {
  it("Friday + 5 working days → next Friday", () => {
    // 2026-07-24 is a Friday
    assert.equal(addWorkingDays("2026-07-24", 5), "2026-07-31");
  });

  it("Thursday + 1 working day → Friday", () => {
    // 2026-07-23 is a Thursday
    assert.equal(addWorkingDays("2026-07-23", 1), "2026-07-24");
  });

  it("Friday + 1 working day → Monday (weekend skipped)", () => {
    assert.equal(addWorkingDays("2026-07-24", 1), "2026-07-27");
  });
});

describe("resolveWebhookDue", () => {
  it("fixed absolute due", () => {
    const r = resolveWebhookDue({
      due_date: "2026-08-20",
      due_date_mode: "fixed",
      due_date_status: "set",
    });
    assert.equal(r.dueDate, "2026-08-20");
    assert.equal(r.specs.due_date_status, "set");
    assert.equal(r.specs.due_date_mode, "fixed");
  });

  it("old payload with only due_date → fixed absolute", () => {
    const r = resolveWebhookDue({ due_date: "2026-08-20" });
    assert.equal(r.dueDate, "2026-08-20");
    assert.equal(r.specs.due_date_status, "set");
    assert.equal(r.specs.due_date_mode, "fixed");
  });

  it("after approval before confirm — no invented calendar date", () => {
    const r = resolveWebhookDue({
      due_date: "",
      due_date_mode: "after_approval",
      due_processing_days: 5,
      due_date_label: "5 working days after approval",
      due_date_status: "pending_approval",
    });
    assert.equal(r.dueDate, null);
    assert.equal(r.specs.due_date_mode, "after_approval");
    assert.equal(r.specs.due_processing_days, 5);
    assert.equal(r.specs.due_date_status, "pending_approval");
    assert.equal(r.specs.due_date_label, "5 working days after approval");
  });

  it("materialized after-approval overwrites relative state", () => {
    const r = resolveWebhookDue({
      due_date: "2026-07-31",
      due_date_mode: "after_approval",
      due_processing_days: 5,
      due_anchor_at: "2026-07-24T19:12:00.000Z",
      due_date_status: "set",
      due_date_label: "Jul 31, 2026 (5 working days after approval)",
    });
    assert.equal(r.dueDate, "2026-07-31");
    assert.equal(r.specs.due_date_status, "set");
    assert.equal(r.specs.due_processing_days, 5);
    assert.equal(r.specs.due_anchor_at, "2026-07-24T19:12:00.000Z");
  });

  it("empty due_date without relative fields → no due", () => {
    const r = resolveWebhookDue({ due_date: "" });
    assert.equal(r.dueDate, null);
    assert.equal(r.specs.due_date_status, "none");
  });
});

describe("display helpers", () => {
  it("shows pending label when no absolute date", () => {
    const specs = {
      due_date_mode: "after_approval",
      due_processing_days: 5,
      due_date_status: "pending_approval",
      due_date_label: "5 working days after approval",
    };
    assert.equal(isPendingAfterApprovalDue(null, specs), true);
    assert.equal(
      formatOrderDueDisplay(null, specs, (d) => d),
      "5 working days after approval"
    );
    assert.equal(formatPendingDueChipLabel(specs), "5 wd after approval");
  });

  it("prefers absolute date once set", () => {
    const specs = {
      due_date_mode: "after_approval",
      due_processing_days: 5,
      due_date_status: "set",
      due_date_label: "5 working days after approval",
    };
    assert.equal(isPendingAfterApprovalDue("2026-07-31", specs), false);
    assert.equal(
      formatOrderDueDisplay("2026-07-31", specs, (d) => `ABS:${d}`),
      "ABS:2026-07-31"
    );
  });
});

describe("materializeAfterApprovalDue", () => {
  it("materializes pending after-approval on approval day", () => {
    const specs = {
      due_date_mode: "after_approval",
      due_processing_days: 5,
      due_date_status: "pending_approval",
    };
    // Friday approval → due next Friday (local calendar day)
    const r = materializeAfterApprovalDue(
      specs,
      null,
      new Date(2026, 6, 24, 12, 0, 0)
    );
    assert.ok(r);
    assert.equal(r!.dueDate, "2026-07-31");
    assert.equal(r!.specs.due_date_status, "set");
    assert.equal(r!.specs.due_processing_days, 5);
    assert.ok(r!.specs.due_anchor_at);
  });

  it("does not overwrite an existing calendar due", () => {
    const specs = {
      due_date_mode: "after_approval",
      due_processing_days: 5,
      due_date_status: "pending_approval",
    };
    const r = materializeAfterApprovalDue(specs, "2026-08-01", new Date());
    assert.equal(r, null);
  });
});

describe("recomputeDueFromProcessingDays", () => {
  it("recomputes from the same anchor when N changes", () => {
    const specs = {
      due_date_mode: "after_approval",
      due_processing_days: 5,
      due_date_status: "set",
      due_anchor_at: "2026-07-24T15:00:00.000Z",
    };
    const r = recomputeDueFromProcessingDays(specs, "2026-07-31", 1);
    assert.ok(r);
    assert.equal(r!.dueDate, "2026-07-27"); // Friday + 1 wd → Monday
    assert.equal(r!.specs.due_processing_days, 1);
  });

  it("keeps pending (no calendar date) when still awaiting approval", () => {
    const specs = {
      due_date_mode: "after_approval",
      due_processing_days: 5,
      due_date_status: "pending_approval",
    };
    const r = recomputeDueFromProcessingDays(specs, null, 3);
    assert.ok(r);
    assert.equal(r!.dueDate, null);
    assert.equal(r!.specs.due_processing_days, 3);
    assert.equal(r!.specs.due_date_status, "pending_approval");
  });
});
