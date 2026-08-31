import assert from "node:assert/strict";
import { test } from "node:test";
import { pickMissingInfoColumn } from "./missing-info-column.ts";

test("prefers an exception-kind column named 'missing'", () => {
  const cols = [
    { id: "start", name: "Start (Create Order)", kind: "normal" },
    { id: "mi", name: "Missing Info / Changes", kind: "exception" },
    { id: "cr", name: "Customer Replied", kind: "exception" },
  ];
  assert.deepEqual(pickMissingInfoColumn(cols), {
    id: "mi",
    name: "Missing Info / Changes",
  });
});

test("falls back to any column named 'missing' when kind isn't exception", () => {
  const cols = [
    { id: "start", name: "Start", kind: "normal" },
    { id: "mi", name: "Missing info", kind: "normal" },
  ];
  assert.equal(pickMissingInfoColumn(cols)?.id, "mi");
});

test("falls back to any exception column when nothing is named 'missing'", () => {
  const cols = [
    { id: "start", name: "Start", kind: "normal" },
    { id: "exc", name: "On Hold", kind: "exception" },
  ];
  assert.equal(pickMissingInfoColumn(cols)?.id, "exc");
});

test("returns null when there is no candidate", () => {
  const cols = [
    { id: "start", name: "Start", kind: "normal" },
    { id: "prod", name: "In Production", kind: "normal" },
  ];
  assert.equal(pickMissingInfoColumn(cols), null);
});
