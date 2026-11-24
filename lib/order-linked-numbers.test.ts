import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyLinkedOrderNumbers,
  cardLinkedNumberLabels,
  linkedOrderNumbersFromWebhook,
  parseLinkedOrderNumber,
} from "./order-linked-numbers.ts";
import { orderMatchesNumberSearch } from "./order-number-tokens.ts";

describe("parseLinkedOrderNumber", () => {
  it("accepts trimmed letters/digits/dashes", () => {
    assert.equal(parseLinkedOrderNumber("  ORD-2026-15643 "), "ORD-2026-15643");
    assert.equal(parseLinkedOrderNumber("BZ-529"), "BZ-529");
  });
  it("rejects empty, non-strings, bad characters and > 40 chars", () => {
    assert.equal(parseLinkedOrderNumber(""), null);
    assert.equal(parseLinkedOrderNumber("   "), null);
    assert.equal(parseLinkedOrderNumber(15643), null);
    assert.equal(parseLinkedOrderNumber(null), null);
    assert.equal(parseLinkedOrderNumber("ORD 2026"), null);
    assert.equal(parseLinkedOrderNumber("#529"), null);
    assert.equal(parseLinkedOrderNumber("<b>x</b>"), null);
    assert.equal(parseLinkedOrderNumber("A".repeat(40)), "A".repeat(40));
    assert.equal(parseLinkedOrderNumber("A".repeat(41)), null);
  });
});

describe("linkedOrderNumbersFromWebhook", () => {
  it("reads order-level values", () => {
    assert.deepEqual(
      linkedOrderNumbersFromWebhook({
        crm_order_number: "ORD-2026-15643",
        portal_order_number: "BZ-529",
      }),
      { crm_order_number: "ORD-2026-15643", portal_order_number: "BZ-529" }
    );
  });
  it("item-level overrides order-level; invalid item falls back", () => {
    assert.deepEqual(
      linkedOrderNumbersFromWebhook(
        { crm_order_number: "ORD-2026-1", portal_order_number: "BZ-1" },
        { crm_order_number: "ORD-2026-2", portal_order_number: "bad value!" }
      ),
      { crm_order_number: "ORD-2026-2", portal_order_number: "BZ-1" }
    );
  });
  it("omits keys that are missing or invalid", () => {
    assert.deepEqual(linkedOrderNumbersFromWebhook({}), {});
    assert.deepEqual(linkedOrderNumbersFromWebhook(null, null), {});
    assert.deepEqual(
      linkedOrderNumbersFromWebhook({ crm_order_number: "  " }),
      {}
    );
  });
});

describe("applyLinkedOrderNumbers (additive)", () => {
  it("sets provided keys and leaves every other spec key alone", () => {
    const specs: Record<string, unknown> = {
      billing: { balance: 340 },
      webhook_order_number: "BZ-529",
    };
    const changed = applyLinkedOrderNumbers(specs, {
      crm_order_number: "ORD-2026-15643",
    });
    assert.equal(changed, true);
    assert.deepEqual(specs, {
      billing: { balance: 340 },
      webhook_order_number: "BZ-529",
      crm_order_number: "ORD-2026-15643",
    });
  });
  it("never clears an existing value when the payload omits it", () => {
    const specs: Record<string, unknown> = {
      crm_order_number: "ORD-2026-15643",
      portal_order_number: "BZ-529",
    };
    assert.equal(applyLinkedOrderNumbers(specs, {}), false);
    assert.equal(specs.crm_order_number, "ORD-2026-15643");
    assert.equal(specs.portal_order_number, "BZ-529");
  });
  it("updates to a newly sent value", () => {
    const specs: Record<string, unknown> = { crm_order_number: "ORD-2026-1" };
    assert.equal(
      applyLinkedOrderNumbers(specs, { crm_order_number: "ORD-2026-2" }),
      true
    );
    assert.equal(specs.crm_order_number, "ORD-2026-2");
  });
});

describe("cardLinkedNumberLabels", () => {
  it("BZ card shows the CRM number", () => {
    assert.deepEqual(
      cardLinkedNumberLabels("BZ-529", {
        crm_order_number: "ORD-2026-15643",
        portal_order_number: "BZ-529",
      }),
      ["CRM ORD-2026-15643"]
    );
  });
  it("CRM card shows the portal number, not its own CRM number", () => {
    assert.deepEqual(
      cardLinkedNumberLabels("0723-1", {
        crm_order_number: "ORD-2026-0723",
        portal_order_number: "BZ-529",
      }),
      ["Portal BZ-529"]
    );
    assert.deepEqual(
      cardLinkedNumberLabels("ORD-2026-15643", {
        crm_order_number: "ORD-2026-15643",
        portal_order_number: "BZ-529",
      }),
      ["Portal BZ-529"]
    );
  });
  it("multi-line portal card BZ-529-2 does not repeat BZ-529", () => {
    assert.deepEqual(
      cardLinkedNumberLabels("BZ-529-2", { portal_order_number: "BZ-529" }),
      []
    );
  });
  it("falls back to bazaar_order_number for the portal label", () => {
    assert.deepEqual(
      cardLinkedNumberLabels("15643", { bazaar_order_number: "BZ-529" }),
      ["Portal BZ-529"]
    );
  });
  it("nothing when no linked numbers", () => {
    assert.deepEqual(cardLinkedNumberLabels("BZ-529", {}), []);
    assert.deepEqual(cardLinkedNumberLabels("BZ-529", null), []);
  });
});

describe("board search matches linked numbers", () => {
  const card = {
    title: "BZ-529",
    specs: { crm_order_number: "ORD-2026-15643" },
  };
  it("finds a BZ card by its CRM number", () => {
    assert.equal(orderMatchesNumberSearch(card, "ORD-2026-15643"), true);
    assert.equal(orderMatchesNumberSearch(card, "15643"), true);
  });
  it("finds a CRM card by its portal number", () => {
    assert.equal(
      orderMatchesNumberSearch(
        { title: "15643", specs: { portal_order_number: "BZ-529" } },
        "BZ-529"
      ),
      true
    );
  });
});
