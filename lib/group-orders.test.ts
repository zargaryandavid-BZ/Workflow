import assert from "node:assert/strict";
import { test } from "node:test";
import { groupingKeysForSiblingFetch } from "./group-orders.ts";

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
