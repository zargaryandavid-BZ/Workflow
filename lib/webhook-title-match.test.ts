import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { titleMatchIsSameOrder } from "./webhook-title-match.ts";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse("2027-01-10T00:00:00Z");
const maxAge = 90 * DAY;

describe("titleMatchIsSameOrder", () => {
  it("refuses last year's card with the same short number", () => {
    assert.equal(
      titleMatchIsSameOrder(
        { webhook_order_number: "ORD-2026-0486" },
        "2026-01-05T00:00:00Z",
        "ORD-2027-0486",
        "",
        maxAge,
        now
      ),
      false
    );
  });

  it("accepts the same order number or CRM id", () => {
    assert.equal(
      titleMatchIsSameOrder({ webhook_order_number: "ORD-2027-0486" }, null, "ORD-2027-0486", "", maxAge, now),
      true
    );
    assert.equal(
      titleMatchIsSameOrder({ crm_order_id: "c-9" }, null, "ORD-2027-0486", "c-9", maxAge, now),
      true
    );
  });

  it("accepts a card with no ids only when recent", () => {
    assert.equal(
      titleMatchIsSameOrder({}, new Date(now - 10 * DAY).toISOString(), "ORD-2027-0486", "", maxAge, now),
      true
    );
    assert.equal(
      titleMatchIsSameOrder({}, new Date(now - 200 * DAY).toISOString(), "ORD-2027-0486", "", maxAge, now),
      false
    );
  });
});
