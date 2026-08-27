import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decisionsBySkuId,
  formatSkuApprovalNote,
  overallApprovalResponse,
  parseSkuApprovalNote,
  skuLabel,
} from "./sku-approval.ts";

describe("sku approval notes", () => {
  it("numbers SKUs with optional names", () => {
    assert.equal(skuLabel(1, "Caviar"), "SKU 1 — Caviar");
    assert.equal(skuLabel(2, "  "), "SKU 2");
  });

  it("round-trips decisions and the customer comment", () => {
    const note = formatSkuApprovalNote(
      [
        {
          skuId: "a",
          index: 1,
          name: "CRACK DEN CAVIAR | 5 1/8\"",
          decision: "approved",
        },
        {
          skuId: "b",
          index: 2,
          name: "THIS CAVIAR IS NOT | 5 3/8\"",
          decision: "rejected",
        },
      ],
      "Make overall size larger"
    );
    const parsed = parseSkuApprovalNote(note);
    assert.equal(parsed.entries.length, 2);
    assert.equal(parsed.entries[0].decision, "approved");
    assert.equal(parsed.entries[1].decision, "rejected");
    assert.equal(parsed.comment, "Make overall size larger");
    assert.equal(overallApprovalResponse(parsed.entries), "changes_requested");
    assert.deepEqual(
      decisionsBySkuId([{ id: "a" }, { id: "b" }], parsed.entries),
      { a: "approved", b: "rejected" }
    );
  });

  it("treats a plain note as a comment only", () => {
    const parsed = parseSkuApprovalNote("Please reprint.");
    assert.equal(parsed.entries.length, 0);
    assert.equal(parsed.comment, "Please reprint.");
  });
});
