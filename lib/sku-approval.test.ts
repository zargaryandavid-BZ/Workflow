import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approvalImageAssetId,
  approvalImageSlotCount,
  decisionsBySkuId,
  formatSkuApprovalNote,
  imageDecisionKey,
  imageDecisionsByKey,
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
    assert.equal(parsed.imageEntries.length, 0);
    assert.equal(parsed.comment, "Please reprint.");
  });

  it("round-trips per-image decisions on a multi-image SKU", () => {
    const note = formatSkuApprovalNote(
      [
        {
          skuId: "b",
          index: 2,
          name: "Box Back",
          decision: "approved",
        },
      ],
      [
        {
          skuId: "a",
          skuIndex: 1,
          skuName: "Logo Front",
          assetId: "img-1",
          imageIndex: 1,
          decision: "approved",
        },
        {
          skuId: "a",
          skuIndex: 1,
          skuName: "Logo Front",
          assetId: "img-2",
          imageIndex: 2,
          decision: "rejected",
        },
      ],
      "Fix image 2"
    );
    const parsed = parseSkuApprovalNote(note);
    assert.equal(parsed.imageEntries.length, 2);
    assert.equal(parsed.imageEntries[0].imageIndex, 1);
    assert.equal(parsed.imageEntries[0].decision, "approved");
    assert.equal(parsed.imageEntries[1].decision, "rejected");
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0].name, "Box Back");
    assert.equal(parsed.comment, "Fix image 2");
    assert.equal(
      overallApprovalResponse([
        ...parsed.entries,
        ...parsed.imageEntries,
      ]),
      "changes_requested"
    );
    assert.deepEqual(
      decisionsBySkuId(
        [{ id: "a" }, { id: "b" }],
        parsed.entries,
        parsed.imageEntries
      ),
      { a: "rejected", b: "approved" }
    );
  });

  it("rolls a SKU up to approved only when every image is approved", () => {
    assert.deepEqual(
      decisionsBySkuId(
        [{ id: "a" }],
        [],
        [
          { skuIndex: 1, decision: "approved" },
          { skuIndex: 1, decision: "approved" },
        ]
      ),
      { a: "approved" }
    );
  });

  it("maps extra PDF pages to pdfpage:N slots", () => {
    assert.equal(approvalImageAssetId(1, [{ id: "a" }]), "a");
    assert.equal(approvalImageAssetId(2, [{ id: "a" }]), "pdfpage:2");
    assert.equal(approvalImageSlotCount(10, 12), 12);
    assert.equal(approvalImageSlotCount(10, 0), 10);
    assert.equal(approvalImageSlotCount(3, 5), 5);
    assert.equal(approvalImageSlotCount(1, 12), 12);
    assert.equal(approvalImageSlotCount(0, 5), 5);
    assert.equal(approvalImageSlotCount(1, 1), 1);
    assert.deepEqual(
      imageDecisionsByKey(
        [{ id: "sku" }],
        { sku: [{ id: "img-1" }] },
        [
          { skuIndex: 1, imageIndex: 1, decision: "approved" },
          { skuIndex: 1, imageIndex: 2, decision: "rejected" },
        ]
      ),
      {
        [imageDecisionKey("sku", "pdfpage:1")]: "approved",
        [imageDecisionKey("sku", "pdfpage:2")]: "rejected",
      }
    );
  });
});
