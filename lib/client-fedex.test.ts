import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clientFedExAccountFromSelection,
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
    const sel = clientFedExSelection("12-3456-7890");
    assert.equal(isClientFedExSelection(sel), true);
    assert.equal(clientFedExAccountFromSelection(sel), "1234567890");
    assert.equal(isClientFedExSelection(null), false);
  });
});
