import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cardPartNumber,
  parseCrmPoLineNumber,
  webhookItemDisplayTitle,
} from "./webhook-line-title.ts";

describe("parseCrmPoLineNumber", () => {
  it("reads spaced CRM line names", () => {
    assert.equal(
      parseCrmPoLineNumber("PO #117686 - 4 (1 sku 1 X 3 rectangle- Total 1000)"),
      4
    );
  });

  it("reads glued CRM line names", () => {
    assert.equal(
      parseCrmPoLineNumber("PO #117686-1- 2 skus 1 inch circle- 10,000 total"),
      1
    );
  });

  it("ignores shared job names", () => {
    assert.equal(parseCrmPoLineNumber("INCURE LIVE RESIN BOXES"), null);
  });
});

describe("cardPartNumber", () => {
  it("prefers webhook_item_index", () => {
    assert.equal(
      cardPartNumber({ title: "15137-9", specs: { webhook_item_index: 3 } }),
      4
    );
  });

  it("falls back to title suffix", () => {
    assert.equal(cardPartNumber({ title: "15137-4", specs: {} }), 4);
  });
});

describe("webhookItemDisplayTitle", () => {
  it("uses line_title when title is empty", () => {
    assert.equal(
      webhookItemDisplayTitle({
        line_title: "PO #117686 - 4 (1 sku 1 X 3 rectangle- Total 1000)",
      }),
      "PO #117686 - 4 (1 sku 1 X 3 rectangle- Total 1000)"
    );
  });

  it("prefers title over name", () => {
    assert.equal(
      webhookItemDisplayTitle({
        title: "PO #117686 - 4 (1 sku 1 X 3 rectangle- Total 1000)",
        name: "DIE FOR 2.5INCH SQAURE",
      }),
      "PO #117686 - 4 (1 sku 1 X 3 rectangle- Total 1000)"
    );
  });
});
