import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  alignSkusToPdfPages,
  finalPdfOcgView,
  pickFinalArtworkPdf,
  sharedPdfPagesForSkus,
} from "./shared-pdf-pages.ts";

describe("alignSkusToPdfPages", () => {
  it("keeps one SKU when the PDF has one page even if the ticket has three", () => {
    const aligned = alignSkusToPdfPages(
      [
        { id: "a", name: "Front", qty: 1 },
        { id: "b", name: "Back", qty: 1 },
        { id: "c", name: "Extra", qty: 1 },
      ],
      1
    );
    assert.equal(aligned.length, 1);
    assert.equal(aligned[0]?.id, "a");
    assert.equal(aligned[0]?.name, "Front");
  });

  it("adds SKU rows when the PDF has more pages than the ticket", () => {
    const aligned = alignSkusToPdfPages(
      [{ id: "a", name: "Cards", qty: 1 }],
      3
    );
    assert.equal(aligned.length, 3);
    assert.equal(aligned[0]?.id, "a");
    assert.equal(aligned[1]?.id, "__pdf_page_2__");
    assert.equal(aligned[2]?.id, "__pdf_page_3__");
  });
});

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

  it("locks a single SKU to page 1", () => {
    const map = sharedPdfPagesForSkus([{ id: "a" }], {
      id: "file",
      name: "job.pdf",
    });
    assert.equal(map.a?.page, 1);
    assert.equal(map.a?.fileId, "file");
  });
});

describe("pickFinalArtworkPdf", () => {
  it("uses the most recently modified file when names differ", () => {
    assert.equal(
      pickFinalArtworkPdf([
        { id: "a", name: "front.pdf", modifiedTime: "2026-09-01T00:00:00Z" },
        { id: "b", name: "back.pdf", modifiedTime: "2026-09-10T00:00:00Z" },
      ])?.id,
      "b"
    );
  });

  it("never returns a stale leftover file just because it's listed first", () => {
    assert.equal(
      pickFinalArtworkPdf([
        { id: "old", name: "v1-final.pdf", modifiedTime: "2026-09-10T00:00:00Z" },
        { id: "new", name: "v2-final.pdf", modifiedTime: "2026-09-15T00:00:00Z" },
      ])?.id,
      "new"
    );
  });

  it("falls back to the first file when modifiedTime is missing on all of them", () => {
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
