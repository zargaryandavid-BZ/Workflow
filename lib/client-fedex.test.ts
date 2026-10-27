import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clientFedExAccountFromSelection,
  clientFedExServiceFromSelection,
  clientFedExSelection,
  isClientFedExSelection,
  maskFedExAccountNumber,
  normalizeFedExAccountNumber,
} from "./client-fedex.ts";

describe("client FedEx account", () => {
  it("normalizes digits and length", () => {
    assert.equal(normalizeFedExAccountNumber("1234-5678-9"), "123456789");
    assert.equal(normalizeFedExAccountNumber("123"), null);
    assert.equal(normalizeFedExAccountNumber(""), null);
  });

  it("masks all but last four", () => {
    assert.equal(maskFedExAccountNumber("123456789"), "••••6789");
  });

  it("builds a client-account shipping selection", () => {
    const sel = clientFedExSelection("12-3456-7890", "FEDEX_2_DAY");
    assert.equal(isClientFedExSelection(sel), true);
    assert.equal(clientFedExAccountFromSelection(sel), "1234567890");
    assert.equal(sel.clientServiceType, "FEDEX_2_DAY");
    assert.equal(sel.serviceName, "FedEx 2Day");
    assert.equal(isClientFedExSelection(null), false);
  });

  it("defaults unsupported service values to FedEx Ground", () => {
    const sel = clientFedExSelection("123456789", "INVALID");
    assert.equal(sel.clientServiceType, "FEDEX_GROUND");
    assert.equal(sel.serviceName, "FedEx Ground");
  });

  it("uses Ground for legacy saved client-account choices", () => {
    assert.equal(
      clientFedExServiceFromSelection({
        serviceType: "CLIENT_ACCOUNT",
        serviceName: "FedEx with my account",
        totalCharge: null,
        currency: "USD",
        deliveryDate: null,
        transitDays: null,
        provider: "fedex",
        clientAccountNumber: "717201728",
      }),
      "FEDEX_GROUND"
    );
  });
});
