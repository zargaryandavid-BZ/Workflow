import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isExactOrderNumberHit,
  preferExactOrderNumberHits,
} from "./order-number-tokens.ts";

// Real shapes from the board: "610" used to land on 15783-2 (PO 261006).
const orders = [
  { title: "15783-2", specs: { webhook_order_number: "ORD-2026-15783", webhook_item_title: "PO 261006 | Tuck end box" } },
  { title: "0610-1", specs: { webhook_order_number: "ORD-2026-0610" } },
  { title: "W610-1", specs: { webhook_order_number: "610", crm_order_number: "ORD-2026-15804" } },
  { title: "15234-1", specs: { webhook_order_number: "ORD-2026-15234", webhook_item_title: "ORDER # 117610- 100 SHEETS" } },
];

test("610 keeps only cards whose number is 610", () => {
  assert.deepEqual(
    preferExactOrderNumberHits(orders, "610").map((o) => o.title),
    ["0610-1", "W610-1"]
  );
});

test("w610 keeps only the website card; 15783-2 the exact part", () => {
  assert.deepEqual(preferExactOrderNumberHits(orders, "w610").map((o) => o.title), ["W610-1"]);
  assert.deepEqual(preferExactOrderNumberHits(orders, "#15783-2").map((o) => o.title), ["15783-2"]);
});

test("no exact hit keeps all loose matches", () => {
  assert.equal(preferExactOrderNumberHits(orders, "6100").length, orders.length);
});

test("renamed card matches by webhook order number", () => {
  assert.ok(isExactOrderNumberHit({ title: "Bando stickers", specs: { webhook_order_number: "ORD-2026-0610" } }, "610"));
  assert.ok(!isExactOrderNumberHit({ title: "15783-2", specs: {} }, "610"));
});
