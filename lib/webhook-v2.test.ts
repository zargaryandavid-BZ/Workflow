import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCrmSnapshot } from "./crm-catalog-v2.ts";
import {
  isCrmWebhookV2,
  isStaleCrmUpdate,
  overrideKeysOf,
  validateWebhookV2,
} from "./webhook-v2-parse.ts";

const sampleV2 = {
  schema_version: 2,
  event_id: "evt_01J7ABCDEF123456",
  event_type: "order.upsert",
  crm_order_id: "ord_01J7XYZ",
  crm_order_number: "BP-2026-1042",
  crm_updated_at: "2026-08-19T15:30:00Z",
  customer: { name: "Acme Corp", email: "orders@acme.com" },
  due_date: "2026-08-25",
  line_items: [
    {
      line_item_id: "li_001",
      product: { id: "roll-labels", name: "Roll Labels" },
      quantity: 500,
      specifications: [
        {
          key: "MATERIAL",
          label: "Material",
          type: "select",
          value: { option_id: "bopp-clear", label: "Clear BOPP" },
          display_value: "Clear BOPP",
        },
      ],
    },
  ],
};

describe("isCrmWebhookV2", () => {
  it("routes only schema_version 2", () => {
    assert.equal(isCrmWebhookV2(sampleV2), true);
    assert.equal(isCrmWebhookV2({ order_number: "ORD-2026-0001" }), false);
    assert.equal(isCrmWebhookV2({ schema_version: 1 }), false);
  });
});

describe("validateWebhookV2", () => {
  it("accepts a complete payload", () => {
    const result = validateWebhookV2(sampleV2);
    assert.equal(result.ok, true);
  });

  it("rejects missing required fields", () => {
    const missingEvent = validateWebhookV2({ ...sampleV2, event_id: "" });
    assert.equal(missingEvent.ok, false);
    const missingItems = validateWebhookV2({ ...sampleV2, line_items: [] });
    assert.equal(missingItems.ok, false);
  });
});

describe("isStaleCrmUpdate", () => {
  it("rejects an older crm_updated_at", () => {
    assert.equal(
      isStaleCrmUpdate("2026-08-19T16:00:00Z", "2026-08-19T15:30:00Z"),
      true
    );
    assert.equal(
      isStaleCrmUpdate("2026-08-19T15:00:00Z", "2026-08-19T15:30:00Z"),
      false
    );
    assert.equal(isStaleCrmUpdate(null, "2026-08-19T15:30:00Z"), false);
  });
});

describe("overrideKeysOf", () => {
  it("lists sticky override keys", () => {
    const keys = overrideKeysOf({
      due_date: { display_value: "2026-08-30", value: "2026-08-30" },
      MATERIAL: { display_value: "White BOPP", value: "white" },
    });
    assert.equal(keys.has("due_date"), true);
    assert.equal(keys.has("MATERIAL"), true);
    assert.equal(keys.has("customer_name"), false);
  });
});

describe("parseCrmSnapshot v2 nested product", () => {
  it("reads product.id / product.name from the webhook snapshot", () => {
    const parsed = parseCrmSnapshot(sampleV2);
    assert.equal(parsed?.line_items?.[0]?.product_id, "roll-labels");
    assert.equal(parsed?.line_items?.[0]?.product_name, "Roll Labels");
    assert.equal(parsed?.line_items?.[0]?.specifications?.[0]?.key, "MATERIAL");
  });
});
