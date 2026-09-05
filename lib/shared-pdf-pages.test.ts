import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  finalPdfOcgView,
  pickFinalArtworkPdf,
  sharedPdfPagesForSkus,
} from "./shared-pdf-pages.ts";

describe("sharedPdfPagesForSkus", () => {
  it("maps SKU index to PDF page and ignores names", () => {
    const map = sharedPdfPagesForSkus(
      [{ id: "zargaryan" }, { id: "gary" }],
      { id: "file", name: "anything.pdf" }
    );
    assert.equal(map.zargaryan?.page, 1);
    assert.equal(map.gary?.page, 2);
    assert.equal(map.zargaryan?.fileId, "file");
  });

  it("does not lock a single SKU (all pages are sides of that SKU)", () => {
    const map = sharedPdfPagesForSkus([{ id: "a" }], {
      id: "file",
      name: "job.pdf",
    });
    assert.equal(map.a?.page, undefined);
    assert.equal(map.a?.fileId, "file");
  });
});

describe("pickFinalArtworkPdf", () => {
  it("uses the first file when names differ", () => {
    assert.equal(
      pickFinalArtworkPdf([
        { id: "a", name: "front.pdf" },
        { id: "b", name: "back.pdf" },
      ])?.id,
      "a"
    );
  });
});

describe("finalPdfOcgView", () => {
  it("shows only the locked SKU page", () => {
    assert.deepEqual(finalPdfOcgView({ page: 2 }), {
      layout: "single",
      page: 2,
    });
  });
});
