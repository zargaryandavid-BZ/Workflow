import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  crmBaseNumber,
  displayOrderNumber,
  displayOrderNumberText,
} from "./order-display-number.ts";
import { cardLinkedNumberLabels } from "./order-linked-numbers.ts";
import { orderMatchesNumberSearch } from "./order-number-tokens.ts";

describe("displayOrderNumber", () => {
  it("portal single-line card shows the CRM number, BZ as secondary", () => {
    const d = displayOrderNumber({
      title: "BZ-667",
      specs: { crm_order_number: "ORD-2026-15844", webhook_order_number: "BZ-667" },
    });
    assert.deepEqual(d, {
      primary: "15844",
      secondary: "Portal BZ-667",
      portalAsCrm: true,
    });
  });

  it("portal multi-line card keeps the BZ part suffix", () => {
    const d = displayOrderNumber({
      title: "BZ-661-2",
      specs: { crm_order_number: "ORD-2026-15825" },
    });
    assert.equal(d.primary, "15825-2");
    assert.equal(d.secondary, "Portal BZ-661-2");
  });

  it("CRM card is unchanged", () => {
    const d = displayOrderNumber({
      title: "15784-1",
      specs: { crm_order_number: "ORD-2026-15784", portal_order_number: "BZ-600" },
    });
    assert.deepEqual(d, { primary: "15784-1", secondary: null, portalAsCrm: false });
    assert.equal(displayOrderNumberText({ title: "ORD-2026-0509" }), "509");
  });

  it("portal card without a CRM number stays BZ", () => {
    assert.deepEqual(displayOrderNumber({ title: "BZ-667", specs: {} }), {
      primary: "BZ-667",
      secondary: null,
      portalAsCrm: false,
    });
    assert.equal(displayOrderNumber({ title: "BZ-667", specs: null }).primary, "BZ-667");
    assert.equal(
      displayOrderNumber({ title: "BZ-667", specs: { crm_order_number: "junk value" } }).primary,
      "BZ-667"
    );
  });

  it("renamed portal title (product name) is unchanged", () => {
    const d = displayOrderNumber({
      title: "Gummy pouch labels",
      specs: { crm_order_number: "ORD-2026-15844" },
    });
    assert.equal(d.primary, "Gummy pouch labels");
    assert.equal(d.secondary, null);
  });

  it("crmBaseNumber strips prefix and leading zeros", () => {
    assert.equal(crmBaseNumber({ crm_order_number: "ORD-2026-015844" }), "15844");
    assert.equal(crmBaseNumber({ crm_order_number: "15844" }), "15844");
    assert.equal(crmBaseNumber({}), null);
  });
});

describe("portal card search by CRM number", () => {
  const card = {
    title: "BZ-667-2",
    specs: { crm_order_number: "ORD-2026-15844", webhook_order_number: "BZ-667" },
  };
  it("finds by full digits, displayed number and full ORD number", () => {
    assert.ok(orderMatchesNumberSearch(card, "15844"));
    assert.ok(orderMatchesNumberSearch(card, "15844-2"));
    assert.ok(orderMatchesNumberSearch(card, "ORD-2026-15844"));
    assert.ok(orderMatchesNumberSearch(card, "BZ-667"));
  });
});

describe("cardLinkedNumberLabels on portal-as-CRM cards", () => {
  it("shows the portal number instead of the CRM number", () => {
    assert.deepEqual(
      cardLinkedNumberLabels("BZ-667", { crm_order_number: "ORD-2026-15844" }),
      ["Portal BZ-667"]
    );
  });
  it("CRM cards keep their Portal label", () => {
    assert.deepEqual(
      cardLinkedNumberLabels("15784-1", {
        crm_order_number: "ORD-2026-15784",
        portal_order_number: "BZ-600",
      }),
      ["Portal BZ-600"]
    );
  });
});
