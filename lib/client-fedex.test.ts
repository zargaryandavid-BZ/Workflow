import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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
});
