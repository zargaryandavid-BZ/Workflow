import assert from "node:assert/strict";
import { test } from "node:test";
import {
  sharedPdfPagesForSkus,
  uniqueSharedPdfFile,
} from "./shared-pdf-pages.ts";
test("uniqueSharedPdfFile only collapses the SAME file listed twice", () => {
  // Same id listed twice = one PDF.
  assert.equal(
    uniqueSharedPdfFile([
      { id: "a", name: "job.pdf" },
      { id: "a", name: "job.pdf" },
    ])?.id,
    "a"
  );
  // Two DISTINCT files that happen to share a name (old + corrected re-upload)
  // are NOT one PDF — must fall through to newest-wins, not the first listed.
  assert.equal(
    uniqueSharedPdfFile([
      { id: "a", name: "job.pdf" },
      { id: "b", name: "job.pdf" },
    ]),
    null
  );
  assert.equal(
    uniqueSharedPdfFile([
      { id: "a", name: "front.pdf" },
      { id: "b", name: "back.pdf" },
    ]),
    null
  );
});

test("sharedPdfPagesForSkus maps SKU 1 to page 1 and SKU 2 to page 2", () => {
  const out = sharedPdfPagesForSkus(
    [{ id: "sku-a" }, { id: "sku-b" }],
    { id: "file-1", name: "job.pdf" }
  );
  assert.deepEqual(out["sku-a"], {
    fileId: "file-1",
    fileName: "job.pdf",
    page: 1,
  });
  assert.deepEqual(out["sku-b"], {
    fileId: "file-1",
    fileName: "job.pdf",
    page: 2,
  });
});

test("sharedPdfPagesForSkus locks a single SKU to page 1", () => {
  const out = sharedPdfPagesForSkus([{ id: "sku-a" }], {
    id: "file-1",
    name: "job.pdf",
  });
  assert.deepEqual(out["sku-a"], {
    fileId: "file-1",
    fileName: "job.pdf",
    page: 1,
  });
});
