import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isWebsiteWebhookSource,
  withWebOrderLetter,
} from "./web-order-number.ts";

describe("web order numbers", () => {
  it("detects website checkout sources", () => {
    assert.equal(isWebsiteWebhookSource("website"), true);
    assert.equal(isWebsiteWebhookSource("Webform"), true);
    assert.equal(isWebsiteWebhookSource("crm"), false);
    assert.equal(isWebsiteWebhookSource("portal"), false);
  });

  it("prefixes W once", () => {
    assert.equal(withWebOrderLetter("15082"), "W15082");
    assert.equal(withWebOrderLetter("15082-1"), "W15082-1");
    assert.equal(withWebOrderLetter("W15082"), "W15082");
    assert.equal(withWebOrderLetter("w-15082-2"), "W15082-2");
  });
});
