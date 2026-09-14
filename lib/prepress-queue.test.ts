import assert from "node:assert/strict";
import { test } from "node:test";
import { isPrepressColumnName, rankPrepressQueue } from "./prepress-queue.ts";

test("matches Prepress / Pre-press column names", () => {
  assert.equal(isPrepressColumnName("Prepress"), true);
  assert.equal(isPrepressColumnName("Pre-press"), true);
  assert.equal(isPrepressColumnName("Pre Press Queue"), true);
  assert.equal(isPrepressColumnName("Start"), false);
});

test("saved queue position wins", () => {
  const r = rankPrepressQueue([
    { id: "a", queuePos: 2, priority: "urgent", dueDate: null },
    { id: "b", queuePos: 0, priority: "low", dueDate: null },
    { id: "c", queuePos: 1, priority: "normal", dueDate: null },
  ]);
  assert.deepEqual(r, { b: 1, c: 2, a: 3 });
});

test("no saved position → priority then due", () => {
  const r = rankPrepressQueue([
    { id: "a", queuePos: null, priority: "normal", dueDate: "2026-02-01" },
    { id: "b", queuePos: null, priority: "urgent", dueDate: "2026-03-01" },
    { id: "c", queuePos: null, priority: "normal", dueDate: "2026-01-01" },
  ]);
  assert.equal(r.b, 1);
  assert.equal(r.c, 2);
  assert.equal(r.a, 3);
});
