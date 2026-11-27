import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FedExRateOption } from "./types.ts";
import {
  dropSaturdayDuplicates,
  friendlyFedExServiceName,
  fedexCommitmentLabel,
  fedexServiceForAddress,
  groupRatesForPriceChart,
  isFedExHomeDeliveryRequiredError,
  normalizeFedExRatesForAddress,
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

describe("fedexServiceForAddress", () => {
  it("uses Home Delivery for homes, Ground for businesses", () => {
    assert.equal(
      fedexServiceForAddress("FEDEX_GROUND", true),
      "GROUND_HOME_DELIVERY"
    );
    assert.equal(
      fedexServiceForAddress("GROUND_HOME_DELIVERY", false),
      "FEDEX_GROUND"
    );
    assert.equal(
      fedexServiceForAddress("PRIORITY_OVERNIGHT", true),
      "PRIORITY_OVERNIGHT"
    );
  });
});

describe("normalizeFedExRatesForAddress", () => {
  it("hides Ground when Home Delivery is already quoted for a home", () => {
    const rates = normalizeFedExRatesForAddress(
      [
        rate({ serviceType: "FEDEX_GROUND" }),
        rate({ serviceType: "GROUND_HOME_DELIVERY" }),
      ],
      true
    );
    assert.deepEqual(
      rates.map((r) => r.serviceType),
      ["GROUND_HOME_DELIVERY"]
    );
  });
});

describe("isFedExHomeDeliveryRequiredError", () => {
  it("matches FedEx's Ground-to-home rejection", () => {
    assert.equal(
      isFedExHomeDeliveryRequiredError(
        "Based on the information entered this shipment qualifies for FedEx Home Delivery. Please resubmit your request as FedEx Home Delivery to continue with the shipment."
      ),
      true
    );
  });
});

describe("Saturday duplicates (Hayk 2026-11-27, W511)", () => {
  const r = (serviceType: string, deliveryDate: string, totalCharge: number) => ({
    serviceType, serviceName: serviceType, totalCharge, currency: "USD", deliveryDate, transitDays: null,
  });
  it("keeps only the regular delivery when FedEx also offers Saturday", () => {
    const out = dropSaturdayDuplicates([
      r("FIRST_OVERNIGHT", "2026-11-28T08:30:00", 247.23),
      r("FIRST_OVERNIGHT", "2026-11-30T08:30:00", 226.15),
      r("GROUND_HOME_DELIVERY", "2026-11-28T23:59:00", 31.2),
    ]);
    assert.deepEqual(out.map((x) => x.totalCharge), [226.15, 31.2]);
  });
  it("business address: no Home Delivery shown", () => {
    const out = normalizeFedExRatesForAddress(
      [r("FEDEX_GROUND", "2026-12-01", 20), r("GROUND_HOME_DELIVERY", "2026-12-01", 31.2)],
      false
    );
    assert.deepEqual(out.map((x) => x.serviceType), ["FEDEX_GROUND"]);
  });
});
