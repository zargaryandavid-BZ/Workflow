import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMoveCardNote,
  decideIntegrationMove,
  findColumnByName,
  normalizeColumnName,
  parseMoveCardBody,
} from "./orders/move-card-request.ts";

const ID = "9574aedb-45e1-4ee7-aff9-1c66eeb525d4";

test("parseMoveCardBody accepts a card uuid and a column name", () => {
  assert.deepEqual(parseMoveCardBody({ order_id: ID, to_column: "In Production" }), {
    ok: true,
    value: { orderId: ID, toColumn: "In Production" },
  });
});

test("parseMoveCardBody rejects missing fields and non-uuid ids", () => {
  assert.equal(parseMoveCardBody(null).ok, false);
  assert.equal(parseMoveCardBody({ order_id: ID }).ok, false);
  assert.equal(parseMoveCardBody({ order_id: "15463-8", to_column: "In Production" }).ok, false);
  assert.equal(parseMoveCardBody({ order_id: ID, to_column: 5 }).ok, false);
});

test("column names compare ignoring case and spacing", () => {
  assert.equal(normalizeColumnName("  In   Production "), "in production");
  const cols = [{ name: "Prepress" }, { name: "In Production " }];
  assert.equal(findColumnByName(cols, "in production")?.name, "In Production ");
  assert.equal(findColumnByName(cols, "Shipped"), null);
  assert.equal(findColumnByName(cols, ""), null);
});

test("only moves between Prepress and In Production are allowed", () => {
  assert.deepEqual(decideIntegrationMove("Prepress", "In Production"), { allowed: true, already: false });
  assert.deepEqual(decideIntegrationMove("In Production", "Prepress"), { allowed: true, already: false });
  assert.deepEqual(decideIntegrationMove("In Production", "in production"), { allowed: true, already: true });
  assert.deepEqual(decideIntegrationMove("Prepress", "prepress"), { allowed: true, already: true });
  const hold = decideIntegrationMove("Hold", "In Production");
  assert.equal(hold.allowed, false);
  assert.equal(hold.allowed === false && hold.status, 409);
  const shipped = decideIntegrationMove("Shipped Customer", "Prepress");
  assert.equal(shipped.allowed === false && shipped.status, 409);
  const elsewhere = decideIntegrationMove("Prepress", "Shipped Customer");
  assert.equal(elsewhere.allowed === false && elsewhere.status, 403);
});

test("Prepress → Hold is allowed, from anywhere else it is not", () => {
  assert.deepEqual(decideIntegrationMove("Prepress", "Hold"), { allowed: true, already: false });
  assert.deepEqual(decideIntegrationMove("Prepress", "On Hold"), { allowed: true, already: false });
  assert.deepEqual(decideIntegrationMove("Hold", "hold"), { allowed: true, already: true });
  const fromProd = decideIntegrationMove("In Production", "Hold");
  assert.equal(fromProd.allowed === false && fromProd.status, 409);
  const missingInfo = decideIntegrationMove("Prepress", "Missing Info / Changes");
  assert.equal(missingInfo.allowed === false && missingInfo.status, 403);
});

test("parseMoveCardNote keeps text, author and a valid date; drops empty notes", () => {
  assert.equal(parseMoveCardNote(null), null);
  assert.equal(parseMoveCardNote({ text: "   " }), null);
  assert.deepEqual(parseMoveCardNote({ text: " File is low-res ", author: "Davit Z", date: "2026-11-09T18:00:00Z" }), {
    text: "File is low-res",
    author: "Davit Z",
    date: "2026-11-09T18:00:00.000Z",
  });
  assert.deepEqual(parseMoveCardNote({ text: "x", date: "not a date" }), { text: "x", author: "Pulse" });
});

test("parseMoveCardBody carries the optional note", () => {
  const r = parseMoveCardBody({ order_id: ID, to_column: "Hold", note: { text: "Wrong die", author: "A B" } });
  assert.equal(r.ok && r.value.note?.text, "Wrong die");
  const none = parseMoveCardBody({ order_id: ID, to_column: "Hold" });
  assert.equal(none.ok && none.value.note, undefined);
});
