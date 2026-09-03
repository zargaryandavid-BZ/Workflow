import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compactOrderNumberToken,
  dieOrderNumberMatchRank,
  formatShortOrderNumber,
  orderMatchesNumberSearch,
} from "./order-number-tokens.ts";

describe("die order number typeahead", () => {
  it("shows the same short number as the board card", () => {
    assert.equal(formatShortOrderNumber("15084-1"), "15084-1");
    assert.equal(formatShortOrderNumber("ORD-2026-15084-1"), "15084-1");
    assert.equal(compactOrderNumberToken("15084"), "15084");
  });

  it("matches digits against the card number as the user types", () => {
    const order = { title: "15084-1", specs: { webhook_order_number: "ORD-2026-15084" } };
    assert.equal(orderMatchesNumberSearch(order, "15"), true);
    assert.equal(orderMatchesNumberSearch(order, "15084"), true);
    assert.equal(orderMatchesNumberSearch(order, "15084-1"), true);
    assert.equal(orderMatchesNumberSearch(order, "999"), false);
  });

  it("ranks prefix card numbers first", () => {
    const q = "150";
    const a = dieOrderNumberMatchRank({ title: "15084-1" }, q);
    const b = dieOrderNumberMatchRank({ title: "2150-2" }, q);
    assert.equal(a < b, true);
    assert.equal(dieOrderNumberMatchRank({ title: "15084-1" }, "15084-1"), 0);
  });
});
