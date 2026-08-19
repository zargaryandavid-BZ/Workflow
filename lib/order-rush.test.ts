import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isRushOrder,
  parseWebhookRushFlag,
  webhookRushFromPayload,
} from "./order-rush.ts";

describe("parseWebhookRushFlag", () => {
  it("accepts boolean, 1, and common strings", () => {
    assert.equal(parseWebhookRushFlag(true), true);
    assert.equal(parseWebhookRushFlag(1), true);
    assert.equal(parseWebhookRushFlag("rush"), true);
    assert.equal(parseWebhookRushFlag("YES"), true);
    assert.equal(parseWebhookRushFlag("true"), true);
    assert.equal(parseWebhookRushFlag(false), false);
    assert.equal(parseWebhookRushFlag("no"), false);
    assert.equal(parseWebhookRushFlag(""), false);
  });
});

describe("webhookRushFromPayload", () => {
  it("reads aliases and reports presence", () => {
    assert.equal(webhookRushFromPayload({ rush: true }), true);
    assert.equal(webhookRushFromPayload({ is_rush: "yes" }), true);
    assert.equal(webhookRushFromPayload({ rush_order: false }), false);
    assert.equal(webhookRushFromPayload({ rush_status: "rush" }), true);
    assert.equal(webhookRushFromPayload({}), undefined);
  });
});

describe("isRushOrder", () => {
  it("is true from specs.rush or a Rush tag, not from priority alone", () => {
    assert.equal(isRushOrder({ specs: { rush: true } }), true);
    assert.equal(isRushOrder({ tag: { name: "Rush Order" } }), true);
    assert.equal(isRushOrder({ specs: { rush: false } }), false);
    assert.equal(isRushOrder({}), false);
  });
});
