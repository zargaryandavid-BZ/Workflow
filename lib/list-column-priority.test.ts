import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  columnPriorityMode,
  mergeSubsetOrder,
  moveId,
  moveIdToNumber,
  posByIdFromOrder,
  positionForMovedId,
  priorityGroupKey,
  sortForColumnPriority,
} from "./list-column-priority.ts";

describe("columnPriorityMode", () => {
  it("Start uses the designer queue", () => {
    assert.equal(columnPriorityMode("Start (Create Order)"), "designer_queue");
    assert.equal(columnPriorityMode("Start"), "designer_queue");
  });
  it("In Progress is read-only queue order", () => {
    assert.equal(columnPriorityMode("In Progress"), "designer_queue_readonly");
  });
  it("Prepress uses the shared prepress queue", () => {
    assert.equal(columnPriorityMode("Pre-press"), "prepress_queue");
    assert.equal(columnPriorityMode("Prepress"), "prepress_queue");
  });
  it("other columns use manual order", () => {
    assert.equal(columnPriorityMode("Printing"), "manual_position");
    assert.equal(columnPriorityMode(null), "manual_position");
  });
});

describe("sortForColumnPriority", () => {
  const o = (
    id: string,
    pos: number | null,
    extra: Partial<{ priority: string; due_date: string; position: number }> = {}
  ) => ({
    id,
    position: extra.position ?? 0,
    priority: extra.priority ?? null,
    due_date: extra.due_date ?? null,
    specs: pos == null ? { designer_id: "d1" } : { designer_id: "d1", designer_queue_pos: pos },
  });

  it("orders by saved queue pos, unset last (website orders included)", () => {
    const out = sortForColumnPriority(
      [o("web", null), o("b", 1), o("a", 0)],
      "designer_queue"
    );
    assert.deepEqual(out.map((r) => r.id), ["a", "b", "web"]);
  });

  it("unset queue pos falls back to priority then due date", () => {
    const out = sortForColumnPriority(
      [
        o("late", null, { due_date: "2026-12-01" }),
        o("urgent", null, { priority: "urgent" }),
        o("soon", null, { due_date: "2026-10-20" }),
      ],
      "designer_queue"
    );
    assert.deepEqual(out.map((r) => r.id), ["urgent", "soon", "late"]);
  });

  it("manual_position sorts by position", () => {
    const out = sortForColumnPriority(
      [o("x", null, { position: 3000 }), o("y", null, { position: 1000 })],
      "manual_position"
    );
    assert.deepEqual(out.map((r) => r.id), ["y", "x"]);
  });

  it("groups per designer only for queue modes", () => {
    const row = o("a", 0);
    assert.equal(priorityGroupKey(row, "designer_queue"), "d1");
    assert.equal(priorityGroupKey(row, "manual_position"), "all");
  });
});

describe("reorder → renumber", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves a row down / up", () => {
    assert.deepEqual(moveId(ids, "a", 2), ["b", "c", "a", "d"]);
    assert.deepEqual(moveId(ids, "d", 0), ["d", "a", "b", "c"]);
  });

  it("clamps out-of-range targets and ignores unknown ids", () => {
    assert.deepEqual(moveId(ids, "b", 99), ["a", "c", "d", "b"]);
    assert.deepEqual(moveId(ids, "b", -5), ["b", "a", "c", "d"]);
    assert.equal(moveId(ids, "zz", 1), ids);
  });

  it("typed number is 1-based; bad input is a no-op", () => {
    assert.deepEqual(moveIdToNumber(ids, "d", 1), ["d", "a", "b", "c"]);
    assert.deepEqual(moveIdToNumber(ids, "a", 3), ["b", "c", "a", "d"]);
    assert.equal(moveIdToNumber(ids, "a", 0), ids);
    assert.equal(moveIdToNumber(ids, "a", Number.NaN), ids);
  });

  it("renumbers contiguously from 0 (badge shows #1..#N)", () => {
    assert.deepEqual(posByIdFromOrder(["c", "a", "b"]), { c: 0, a: 1, b: 2 });
  });

  it("merges a filtered subset back without moving hidden cards", () => {
    // Full queue: a b H1 c H2 — the list only shows a, b, c and puts c on top.
    const merged = mergeSubsetOrder(["a", "b", "H1", "c", "H2"], ["c", "a", "b"]);
    assert.deepEqual(merged, ["c", "a", "H1", "b", "H2"]);
  });

  it("drops visible ids that left the queue meanwhile", () => {
    const merged = mergeSubsetOrder(["a", "b"], ["gone", "b", "a"]);
    assert.deepEqual(merged, ["b", "a"]);
  });

  it("manual order: one new position between new neighbours", () => {
    const positions = { a: 1000, b: 2000, c: 3000 };
    assert.equal(positionForMovedId(["a", "c", "b"], "c", positions), 1500);
    assert.equal(positionForMovedId(["c", "a", "b"], "c", positions), 0);
    assert.equal(positionForMovedId(["a", "b", "c"], "a", positions), 1000);
  });
});
