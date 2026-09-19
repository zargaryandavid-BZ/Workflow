import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approvalPreviewIsStale,
  drivePdfFingerprint,
  indexHasLayerPictures,
  proofRasterRev,
  shouldRebuildStoredProofs,
} from "./approval-preview-freshness.ts";

const stored = {
  fileId: "pdf-1",
  rev: "2026-09-19T10:00:00.000Z",
  pages: [1],
  bySku: { sku: { fileId: "pdf-1" } },
};

describe("approvalPreviewIsStale", () => {
  it("is stale when nothing is stored", () => {
    assert.equal(
      approvalPreviewIsStale(null, { fileId: "pdf-1", rev: "t1" }),
      true
    );
  });

  it("is current when file id and rev match", () => {
    assert.equal(
      approvalPreviewIsStale(stored, {
        fileId: "pdf-1",
        rev: "2026-09-19T10:00:00.000Z",
      }),
      false
    );
  });

  it("is stale when the same Drive file is overwritten", () => {
    assert.equal(
      approvalPreviewIsStale(stored, {
        fileId: "pdf-1",
        rev: "2026-09-19T18:00:00.000Z",
      }),
      true
    );
  });

  it("is stale when a different PDF replaces the old one", () => {
    assert.equal(
      approvalPreviewIsStale(stored, {
        fileId: "pdf-2",
        rev: "2026-09-19T10:00:00.000Z",
      }),
      true
    );
  });
});

describe("shouldRebuildStoredProofs", () => {
  it("does not raster from the board when no proof index exists yet", () => {
    assert.equal(
      shouldRebuildStoredProofs(null, { fileId: "pdf-1", rev: "t1" }),
      false
    );
  });

  it("rebuilds when stored proofs belong to an old PDF", () => {
    assert.equal(
      shouldRebuildStoredProofs(stored, { fileId: "pdf-2", rev: "t2" }),
      true
    );
  });
});

describe("indexHasLayerPictures", () => {
  it("requires pages and sku map", () => {
    assert.equal(indexHasLayerPictures(stored), true);
    assert.equal(
      indexHasLayerPictures({ fileId: "a", rev: "b", pages: [], bySku: {} }),
      false
    );
  });
});

describe("drivePdfFingerprint", () => {
  it("joins id and modified time", () => {
    assert.equal(drivePdfFingerprint(" a ", " t "), "a:t");
  });
});

describe("proofRasterRev", () => {
  it("tags Drive modified time so JPEG proofs rebuild as PNG", () => {
    assert.equal(
      proofRasterRev("2026-09-19T10:00:00.000Z"),
      "2026-09-19T10:00:00.000Z-png"
    );
  });
});
