import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyFreeGround, isFreeGroundEligibleRate, specsHaveFreeGround } from "./free-ground.ts";
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
