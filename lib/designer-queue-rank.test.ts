import assert from "node:assert/strict";
import { test } from "node:test";
import { rankDesignerQueue } from "./designer-queue-rank.ts";

test("ranks per designer, saved position wins", () => {
  const r = rankDesignerQueue([
    { id: "a", designerId: "d1", queuePos: 2, priority: "normal", dueDate: null },
    { id: "b", designerId: "d1", queuePos: 0, priority: "low", dueDate: null },
    { id: "c", designerId: "d1", queuePos: 1, priority: "urgent", dueDate: null },
  ]);
  assert.deepEqual(r, { b: 1, c: 2, a: 3 });
});

test("no saved position → priority then due", () => {
  const r = rankDesignerQueue([
    { id: "a", designerId: "d1", queuePos: null, priority: "normal", dueDate: "2026-02-01" },
    { id: "b", designerId: "d1", queuePos: null, priority: "urgent", dueDate: "2026-03-01" },
    { id: "c", designerId: "d1", queuePos: null, priority: "normal", dueDate: "2026-01-01" },
  ]);
  assert.equal(r.b, 1); // urgent first
  assert.equal(r.c, 2); // then earlier due
  assert.equal(r.a, 3);
});

test("each designer numbered independently from 1", () => {
  const r = rankDesignerQueue([
    { id: "a", designerId: "d1", queuePos: 0, priority: "normal", dueDate: null },
    { id: "b", designerId: "d2", queuePos: 0, priority: "normal", dueDate: null },
    { id: "c", designerId: "d2", queuePos: 1, priority: "normal", dueDate: null },
  ]);
  assert.deepEqual(r, { a: 1, b: 1, c: 2 });
});
