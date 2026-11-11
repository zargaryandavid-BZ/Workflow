import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { refreshedBillingFromWebhook } from "./order-billing.ts";

describe("refreshedBillingFromWebhook", () => {
  it("returns null (leave card alone) when the re-fire has no billing fields", () => {
    assert.equal(refreshedBillingFromWebhook({ balance: 340 }, { title: "x" }, {}), null);
  });
  it("latest payload replaces an old balance (CRM price edit reaches the card)", () => {
    const next = refreshedBillingFromWebhook(
      { balance: 340, deposit: 0, payment_status: "partial", source_url: "https://crm/x" },
      { balance: 0, deposit: 2500, payment_status: "full" }
    );
    assert.deepEqual(next, { source_url: "https://crm/x", payment_status: "full", deposit: 2500, balance: 0 });
  });
  it("adds billing to a portal card that never had it", () => {
    const next = refreshedBillingFromWebhook(undefined, { payment_status: "partial", deposit: 0, balance: 1500 });
    assert.deepEqual(next, { source_url: null, payment_status: "partial", deposit: 0, balance: 1500 });
  });
  it("item-level fields override order-level", () => {
    const next = refreshedBillingFromWebhook(null, { balance: 100, deposit: 0 }, { balance: 40 });
    assert.equal(next?.balance, 40);
    assert.equal(next?.deposit, 0);
  });
  it("never clears a value the payload omits", () => {
    const next = refreshedBillingFromWebhook({ deposit: 200, balance: 150 }, { balance: 0 });
    assert.equal(next?.deposit, 200);
    assert.equal(next?.balance, 0);
  });
});
