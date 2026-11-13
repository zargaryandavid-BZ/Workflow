import test from "node:test";
import assert from "node:assert/strict";
import { wholeOrderNumberMatch } from "./board-order-filters";

test("567 matches its own order, not CRM 15672", () => {
  assert.equal(wholeOrderNumberMatch("bz-567 crm ord-2026-15718", "567"), true);
  assert.equal(wholeOrderNumberMatch("bz-539 ord-2026-15672", "567"), false);
  assert.equal(wholeOrderNumberMatch("w567-1 567", "567"), true);
  assert.equal(wholeOrderNumberMatch("15611-1", "15611"), true);
  assert.equal(wholeOrderNumberMatch("15611-1", "15611-1"), true);
});
