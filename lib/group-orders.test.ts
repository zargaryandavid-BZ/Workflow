import assert from "node:assert/strict";
import { test } from "node:test";
import {
  groupOrdersForColumn,
  groupingKeysForSiblingFetch,
  uniqueOrdersById,
} from "./group-orders.ts";
import type { OrderWithRelations } from "./types.ts";

test("groupingKeysForSiblingFetch splits webhook keys and title prefixes", () => {
  const { webhookKeys, titlePrefixes } = groupingKeysForSiblingFetch([
    { title: "Holographic Label", specs: { webhook_order_number: "540" } },
    { title: "129-1", specs: {} },
    { title: "129-2", specs: {} },
    { title: "Solo", specs: {} },
  ]);
  assert.deepEqual(webhookKeys, ["540"]);
  assert.deepEqual(titlePrefixes, ["129"]);
});

test("uniqueOrdersById keeps the first copy of each id", () => {
  assert.deepEqual(
    uniqueOrdersById([
      { id: "2", title: "15102-2" },
      { id: "2", title: "15102-2" },
      { id: "3", title: "15102-3" },
    ]).map((o) => o.id),
    ["2", "3"]
  );
});

test("groupOrdersForColumn does not list the same part twice", () => {
  const one = {
    id: "1",
    title: "15102-1",
    specs: { webhook_order_number: "ORD-2026-15102" },
  } as OrderWithRelations;
  const two = {
    id: "2",
    title: "15102-2",
    specs: { webhook_order_number: "ORD-2026-15102" },
  } as OrderWithRelations;
  const entries = groupOrdersForColumn([one, two, two]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.kind, "group");
  if (entries[0]?.kind === "group") {
    assert.deepEqual(
      entries[0].orders.map((o) => o.id),
      ["1", "2"]
    );
  }
});
