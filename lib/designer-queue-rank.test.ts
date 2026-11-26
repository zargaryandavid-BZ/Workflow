import assert from "node:assert/strict";
import { test } from "node:test";
import { rankDesignerQueue } from "./designer-queue-rank.ts";

const base = { designerId: "d1", priority: "normal", dueDate: null, queuePos: null };

test("Hayk 2026-11-26: rush first, then longest in column", () => {
  const r = rankDesignerQueue([
    { ...base, id: "new", enteredAt: "2026-11-25T10:00:00Z" },
    { ...base, id: "old", enteredAt: "2026-11-20T10:00:00Z" },
    { ...base, id: "rush", rush: true, enteredAt: "2026-11-26T10:00:00Z" },
    { ...base, id: "urgent", priority: "urgent", enteredAt: "2026-11-26T11:00:00Z" },
  ]);
  assert.deepEqual(r, { urgent: 1, rush: 2, old: 3, new: 4 });
});

test("stored position of auto cards is ignored", () => {
  const r = rankDesignerQueue([
    { ...base, id: "a", queuePos: 0, enteredAt: "2026-11-25T10:00:00Z" },
    { ...base, id: "b", queuePos: 1, enteredAt: "2026-11-20T10:00:00Z" },
  ]);
  assert.deepEqual(r, { b: 1, a: 2 });
});

test("a manually placed card keeps its slot; auto cards flow around it", () => {
  const r = rankDesignerQueue([
    { ...base, id: "a", enteredAt: "2026-11-20T10:00:00Z" },
    { ...base, id: "b", enteredAt: "2026-11-21T10:00:00Z" },
    { ...base, id: "rush", rush: true, enteredAt: "2026-11-22T10:00:00Z" },
    { ...base, id: "pinned", manual: true, queuePos: 0, enteredAt: "2026-11-26T10:00:00Z" },
    { ...base, id: "third", manual: true, queuePos: 2, enteredAt: "2026-11-26T10:00:00Z" },
  ]);
  assert.deepEqual(r, { pinned: 1, rush: 2, third: 3, a: 4, b: 5 });
});

test("each designer numbered independently from 1", () => {
  const r = rankDesignerQueue([
    { ...base, id: "a", enteredAt: "2026-11-20T10:00:00Z" },
    { ...base, id: "b", designerId: "d2", enteredAt: "2026-11-20T10:00:00Z" },
    { ...base, id: "c", designerId: "d2", enteredAt: "2026-11-21T10:00:00Z" },
  ]);
  assert.deepEqual(r, { a: 1, b: 1, c: 2 });
});
