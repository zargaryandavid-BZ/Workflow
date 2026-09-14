import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FedExRateOption } from "./types.ts";
import {
  friendlyFedExServiceName,
  fedexCommitmentLabel,
  groupRatesForPriceChart,
} from "./fedex-service-display.ts";

function rate(
  patch: Partial<FedExRateOption> & Pick<FedExRateOption, "serviceType">
): FedExRateOption {
  return {
    serviceName: patch.serviceName ?? patch.serviceType,
    totalCharge: 10,
    currency: "USD",
    deliveryDate: null,
    transitDays: null,
    ...patch,
  };
}

describe("friendlyFedExServiceName", () => {
  it("prefers FedEx API / FedEx.com names", () => {
    assert.equal(
      friendlyFedExServiceName("FEDEX_2_DAY_AM", "FedEx 2Day® AM"),
      "FedEx 2Day® AM"
    );
  });

  it("falls back to 2Day AM without periods", () => {
    assert.equal(friendlyFedExServiceName("FEDEX_2_DAY_AM"), "FedEx 2Day AM");
  });
});

describe("fedexCommitmentLabel", () => {
  it("uses FedEx.com times", () => {
    assert.equal(
      fedexCommitmentLabel(rate({ serviceType: "PRIORITY_OVERNIGHT" })),
      "10:30 AM"
    );
    assert.equal(
      fedexCommitmentLabel(rate({ serviceType: "STANDARD_OVERNIGHT" })),
      "5:00 PM"
    );
    assert.equal(
      fedexCommitmentLabel(rate({ serviceType: "FIRST_OVERNIGHT" })),
      "8:30 AM"
    );
    assert.equal(
      fedexCommitmentLabel(rate({ serviceType: "FEDEX_GROUND" })),
      "End of Day"
    );
  });
});

describe("groupRatesForPriceChart", () => {
  it("groups by delivery day with FedEx.com service order", () => {
    const groups = groupRatesForPriceChart([
      rate({
        serviceType: "FEDEX_GROUND",
        serviceName: "FedEx Ground®",
        deliveryDate: "2026-09-21",
      }),
      rate({
        serviceType: "STANDARD_OVERNIGHT",
        serviceName: "FedEx Standard Overnight®",
        deliveryDate: "2026-09-15",
      }),
      rate({
        serviceType: "PRIORITY_OVERNIGHT",
        serviceName: "FedEx Priority Overnight®",
        deliveryDate: "2026-09-15",
      }),
      rate({
        serviceType: "FIRST_OVERNIGHT",
        serviceName: "FedEx First Overnight®",
        deliveryDate: "2026-09-15",
      }),
    ]);
    assert.equal(groups.length, 2);
    assert.match(groups[0].heading, /Tuesday, September 15, 2026/);
    assert.deepEqual(
      groups[0].rates.map((r) => r.serviceType),
      ["PRIORITY_OVERNIGHT", "STANDARD_OVERNIGHT", "FIRST_OVERNIGHT"]
    );
    assert.match(groups[1].heading, /Monday, September 21, 2026/);
  });
});
