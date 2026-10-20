import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPastApprovalMove,
  planDueOnMove,
  productionGatePosition,
  type GateColumn,
} from "./due-date-on-move.ts";

// Mirrors the live Bazaar board (main tenant) column order + kinds.
const BOARD: GateColumn[] = [
  { id: "start", position: 0, kind: "normal", name: "Start (Create Order)" },
  { id: "hold", position: 1, kind: "normal", name: "Hold" },
  { id: "missing", position: 2, kind: "exception", name: "Missing Info / Changes" },
  { id: "replied", position: 3, kind: "normal", name: "Customer Replied" },
  { id: "waiting", position: 4, kind: "approval", name: "Waiting Approval" },
  { id: "ready", position: 5, kind: "done", name: "Ready for Prod" },
  { id: "arsen", position: 6, kind: "normal", name: "Arsen" },
  { id: "prepress", position: 7, kind: "normal", name: "Prepress" },
  { id: "inprod", position: 10, kind: "normal", name: "In Production" },
  { id: "rts", position: 18, kind: "ready_to_ship", name: "Ready to Ship" },
];

const pendingSpecs = {
  foo: "keep-me",
  due_date_mode: "after_approval",
  due_processing_days: 5,
  due_date_status: "pending_approval",
  due_date_label: "5 working days after approval",
};

// 2026-10-16 is a Friday (15:00 UTC → same local day in US / UTC).
const MOVED_AT = "2026-10-16T15:00:00.000Z";

describe("productionGatePosition", () => {
  it("uses the first done-kind column", () => {
    assert.equal(productionGatePosition(BOARD), 5);
  });

  it("falls back to right after the approval column", () => {
    const cols = BOARD.filter((c) => c.kind !== "done");
    assert.equal(productionGatePosition(cols), 5);
  });

  it("returns null when the board has no done / approval column", () => {
    assert.equal(
      productionGatePosition([
        { id: "a", position: 0, kind: "normal" },
        { id: "b", position: 1, kind: "exception" },
      ]),
      null
    );
  });
});

describe("isPastApprovalMove", () => {
  const mv = (from: string, to: string) =>
    isPastApprovalMove({ fromColumnId: from, toColumnId: to, columns: BOARD });

  it("Waiting Approval → Prepress counts (staff drag)", () => {
    assert.equal(mv("waiting", "prepress"), true);
  });

  it("Waiting Approval → Ready for Prod counts", () => {
    assert.equal(mv("waiting", "ready"), true);
  });

  it("Start → In Production counts (approval skipped)", () => {
    assert.equal(mv("start", "inprod"), true);
  });

  it("Hold / Customer Replied → production counts", () => {
    assert.equal(mv("hold", "arsen"), true);
    assert.equal(mv("replied", "prepress"), true);
  });

  it("moves inside the pre-approval area do not count", () => {
    assert.equal(mv("start", "waiting"), false);
    assert.equal(mv("waiting", "missing"), false);
    assert.equal(mv("start", "hold"), false);
  });

  it("moves between production columns do not count", () => {
    assert.equal(mv("ready", "prepress"), false);
    assert.equal(mv("prepress", "inprod"), false);
    assert.equal(mv("inprod", "rts"), false);
  });

  it("same column / unknown column does not count", () => {
    assert.equal(mv("prepress", "prepress"), false);
    assert.equal(mv("ghost", "prepress"), false);
  });
});

describe("planDueOnMove", () => {
  it("15450-1 case: Waiting Approval → Prepress sets due from move day", () => {
    const plan = planDueOnMove({
      order: { due_date: null, specs: pendingSpecs },
      fromColumnId: "waiting",
      toColumnId: "prepress",
      columns: BOARD,
      movedAt: MOVED_AT,
    });
    assert.ok(plan);
    // Fri + 5 working days → next Fri
    assert.equal(plan.dueDate, "2026-10-23");
    assert.equal(plan.specs.due_date_status, "set");
    assert.equal(plan.specs.due_anchor_at, MOVED_AT);
    assert.equal(plan.specs.due_processing_days, 5);
    assert.equal(plan.specs.due_date_label, "5 working days after approval");
  });

  it("never replaces an existing due date", () => {
    const plan = planDueOnMove({
      order: { due_date: "2026-10-30", specs: pendingSpecs },
      fromColumnId: "waiting",
      toColumnId: "prepress",
      columns: BOARD,
      movedAt: MOVED_AT,
    });
    assert.equal(plan, null);
  });

  it("skips when the clock already started (status set)", () => {
    const plan = planDueOnMove({
      order: {
        due_date: null,
        specs: { ...pendingSpecs, due_date_status: "set" },
      },
      fromColumnId: "waiting",
      toColumnId: "prepress",
      columns: BOARD,
      movedAt: MOVED_AT,
    });
    assert.equal(plan, null);
  });

  it("skips fixed-date jobs", () => {
    const plan = planDueOnMove({
      order: { due_date: null, specs: { due_date_mode: "fixed" } },
      fromColumnId: "waiting",
      toColumnId: "prepress",
      columns: BOARD,
      movedAt: MOVED_AT,
    });
    assert.equal(plan, null);
  });

  it("skips moves that stay before approval", () => {
    const plan = planDueOnMove({
      order: { due_date: null, specs: pendingSpecs },
      fromColumnId: "start",
      toColumnId: "waiting",
      columns: BOARD,
      movedAt: MOVED_AT,
    });
    assert.equal(plan, null);
  });

  it("uses default 5 days when processing days are missing", () => {
    const plan = planDueOnMove({
      order: { due_date: "", specs: { due_date_mode: "after_approval" } },
      fromColumnId: "start",
      toColumnId: "inprod",
      columns: BOARD,
      movedAt: MOVED_AT,
    });
    assert.ok(plan);
    assert.equal(plan.dueDate, "2026-10-23");
  });
});
