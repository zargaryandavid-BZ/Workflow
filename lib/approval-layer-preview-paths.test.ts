import assert from "node:assert/strict";
import { test } from "node:test";
import {
  layerPreviewCachePrefix,
  layerPicsForJobTicket,
  respondLayerPreviewUrl,
  respondPreviewIndexPath,
  sanitizeLayerPreviewRev,
} from "./approval-layer-preview-paths.ts";

test("sanitizeLayerPreviewRev strips Drive timestamp punctuation", () => {
  assert.equal(sanitizeLayerPreviewRev("2026-09-15T21:00:00.000Z"), "2026-09-15T21-00-00.000Z");
});

test("layerPreviewCachePrefix nests file id and rev", () => {
  assert.equal(
    layerPreviewCachePrefix("abc/def", "2026-01-01T00:00:00Z"),
    "approval-layer-previews/abc_def/2026-01-01T00-00-00Z"
  );
});

test("respondPreviewIndexPath is per order", () => {
  assert.equal(
    respondPreviewIndexPath("2e8abf1f-0ac5-4fe6-8466-536f318abc82"),
    "approval-layer-previews/orders/2e8abf1f-0ac5-4fe6-8466-536f318abc82/latest.json"
  );
});

test("respondLayerPreviewUrl is token-gated through the asset route", () => {
  const href = respondLayerPreviewUrl(
    "tok",
    "ord",
    { fileId: "file1", rev: "r1", page: 2 },
    "composite"
  );
  assert.match(href, /type=layer_preview/);
  assert.match(href, /page=2/);
  assert.match(href, /layer=composite/);
});

test("layerPicsForJobTicket uses named layers, not composite", () => {
  const pics = layerPicsForJobTicket({
    layers: [
      { id: "w", name: "White" },
      { id: "a", name: "ART WORK" },
      { id: "x", name: "Layer 3" },
    ],
  });
  assert.deepEqual(
    pics.map((p) => p.name),
    ["White", "ART WORK"]
  );
});

test("layerPicsForJobTicket falls back to composite when only unnamed layers", () => {
  const pics = layerPicsForJobTicket({
    layers: [{ id: "1", name: "Layer 1" }],
  });
  assert.deepEqual(pics, [{ layer: "composite", name: "Proof" }]);
});
