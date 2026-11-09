import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  customerOwnLabelSelection,
  isCustomerOwnLabelSelection,
  ownLabelExtension,
  ownLabelFileName,
} from "./customer-own-label.ts";

describe("customer own label", () => {
  it("marks the selection without a FedEx service (no label purchase, no payment)", () => {
    const sel = customerOwnLabelSelection([{ name: "a.pdf", path: "t/o/a.pdf" }], " UPS Ground ");
    assert.equal(sel.serviceType, "");
    assert.equal(sel.totalCharge, null);
    assert.equal(sel.ownLabelNote, "UPS Ground");
    assert.equal(isCustomerOwnLabelSelection(sel), true);
    assert.equal(isCustomerOwnLabelSelection(null), false);
    assert.equal(isCustomerOwnLabelSelection({ ...sel, ownLabel: undefined }), false);
  });
  it("accepts only pdf / png / jpg", () => {
    assert.equal(ownLabelExtension("application/pdf", "x"), "pdf");
    assert.equal(ownLabelExtension("", "Label.JPEG"), "jpg");
    assert.equal(ownLabelExtension("application/zip", "x.zip"), null);
  });
  it("numbers files only when there are several", () => {
    assert.equal(ownLabelFileName(0, 1, "pdf"), "Customer shipping label.pdf");
    assert.equal(ownLabelFileName(1, 3, "png"), "Customer shipping label 2.png");
  });
});
