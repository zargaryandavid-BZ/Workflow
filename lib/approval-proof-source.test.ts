import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APPROVAL_PROOF_SOURCE,
  approvalPdfPageBySku,
  approvalSkusFromPdfPages,
  ticketUploadsAreApprovalArtwork,
} from "./approval-proof-source.ts";

test("approval source is the production Final PDF", () => {
  assert.equal(APPROVAL_PROOF_SOURCE, "production_pdf");
  assert.equal(ticketUploadsAreApprovalArtwork(), false);
});

test("a 10-page production PDF is 10 SKUs", () => {
  const skus = approvalSkusFromPdfPages(
    [
      { id: "a", name: "1", qty: 500 },
      { id: "b", name: "2", qty: 500 },
    ],
    10
  );
  assert.equal(skus.length, 10);
  assert.equal(skus[0]?.id, "a");
  assert.equal(skus[9]?.id, "__pdf_page_10__");
});

test("SKU N is locked to PDF page N", () => {
  const pages = approvalPdfPageBySku({
    a: { page: 1 },
    b: { page: 2 },
  });
  assert.equal(pages.a, 1);
  assert.equal(pages.b, 2);
});
