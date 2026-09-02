import assert from "node:assert/strict";
import { test } from "node:test";
import {
  sharedPdfPagesForSkus,
  uniqueSharedPdfFile,
} from "./shared-pdf-pages.ts";
test("uniqueSharedPdfFile treats duplicate listings as one PDF", () => {
  assert.equal(
    uniqueSharedPdfFile([
      { id: "a", name: "job.pdf" },
      { id: "b", name: "job.pdf" },
    ])?.id,
    "a"
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

test("sharedPdfPagesForSkus does not lock a page for a single SKU", () => {
  const out = sharedPdfPagesForSkus([{ id: "sku-a" }], {
    id: "file-1",
    name: "job.pdf",
  });
  assert.deepEqual(out["sku-a"], { fileId: "file-1", fileName: "job.pdf" });
});
