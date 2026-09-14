import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickRatedDetail } from "./fedex-rate-pick.ts";

describe("pickRatedDetail", () => {
  it("picks ACCOUNT when LIST is also present", () => {
    const picked = pickRatedDetail([
      { rateType: "ACCOUNT", totalNetCharge: 189.09 },
      { rateType: "LIST", totalNetCharge: 270.6 },
    ]);
    assert.equal(picked?.rateType, "ACCOUNT");
    assert.equal(picked?.totalNetCharge, 189.09);
  });

  it("does not treat LIST as ACCOUNT", () => {
    const picked = pickRatedDetail([
      { rateType: "LIST", totalNetCharge: 270.6 },
      { rateType: "ACCOUNT", totalNetCharge: 189.09 },
    ]);
    assert.equal(picked?.totalNetCharge, 189.09);
  });

  it("picks PAYOR_ACCOUNT_PACKAGE even when actualRateType is PAYOR_LIST_PACKAGE", () => {
    // FedEx sets actualRateType=PAYOR_LIST_PACKAGE when no account discount applies
    // for that service — but the rateType=PAYOR_ACCOUNT_PACKAGE entry is still the
    // correct account-rate row to use.
    const picked = pickRatedDetail([
      {
        rateType: "PAYOR_ACCOUNT_PACKAGE",
        actualRateType: "PAYOR_LIST_PACKAGE",
        totalNetCharge: 132.01,
      },
      {
        rateType: "PAYOR_LIST_PACKAGE",
        actualRateType: "PAYOR_LIST_PACKAGE",
        totalNetCharge: 190.28,
      },
    ]);
    assert.equal(picked?.rateType, "PAYOR_ACCOUNT_PACKAGE");
    assert.equal(picked?.totalNetCharge, 132.01);
  });
});
