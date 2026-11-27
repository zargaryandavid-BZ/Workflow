import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyFreeGround, isFreeGroundEligibleRate, orderQualifiesForFreeGround, specsHaveFreeGround } from "./free-ground.ts";
import type { FedExRateOption } from "./types.ts";

const rate = (serviceType: string, totalCharge: number, extra: Partial<FedExRateOption> = {}): FedExRateOption => ({
  serviceType, serviceName: serviceType, totalCharge, currency: "USD", deliveryDate: null, transitDays: null, provider: "fedex", ...extra,
});

describe("free ground", () => {
  it("makes only Ground free when the order qualifies", () => {
    const out = applyFreeGround([rate("FEDEX_GROUND", 18), rate("FEDEX_2_DAY", 40), rate("GROUND_HOME_DELIVERY", 21)], true);
    assert.deepEqual(out.map((r) => [r.serviceType, r.totalCharge, Boolean(r.freeShipping)]), [
      ["FEDEX_GROUND", 0, true], ["FEDEX_2_DAY", 40, false], ["GROUND_HOME_DELIVERY", 0, true],
    ]);
  });
  it("leaves prices alone when the order does not qualify", () => {
    assert.equal(applyFreeGround([rate("FEDEX_GROUND", 18)], false)[0].totalCharge, 18);
  });
  it("never frees Curri or the customer's own FedEx account", () => {
    assert.equal(isFreeGroundEligibleRate(rate("FEDEX_GROUND", 1, { provider: "curri" })), false);
    assert.equal(isFreeGroundEligibleRate(rate("FEDEX_GROUND", 1, { clientAccountNumber: "123456789" })), false);
  });
  it("reads the flag from card specs", () => {
    assert.equal(specsHaveFreeGround({ free_ground_shipping: true }), true);
    assert.equal(specsHaveFreeGround({ free_ground_shipping: "true" }), false);
    assert.equal(specsHaveFreeGround(null), false);
  });
});

describe("orderQualifiesForFreeGround (Hayk 2026-11-27, W511)", () => {
  it("older website order $500+ without the flag qualifies", () => {
    assert.equal(
      orderQualifiesForFreeGround({
        webhook_source: "website",
        specs: { billing: { deposit: 1148.67, balance: 0 } },
      }),
      true
    );
  });
  it("under $500, broker, or non-website does not", () => {
    assert.equal(orderQualifiesForFreeGround({ webhook_source: "website", specs: { billing: { deposit: 499, balance: 0 } } }), false);
    assert.equal(orderQualifiesForFreeGround({ webhook_source: "website", specs: { bazaar_broker_id: "b1", billing: { deposit: 900 } } }), false);
    assert.equal(orderQualifiesForFreeGround({ webhook_source: "portal", specs: { billing: { deposit: 900 } } }), false);
    assert.equal(orderQualifiesForFreeGround({ webhook_source: "crm", specs: { billing: { deposit: 900 } } }), false);
  });
  it("flag still wins", () => {
    assert.equal(orderQualifiesForFreeGround({ webhook_source: "portal", specs: { free_ground_shipping: true } }), true);
  });
});
