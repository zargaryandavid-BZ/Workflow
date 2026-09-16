import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pdfjsDistRoot,
  pdfjsNodeAssetUrl,
  pdfjsNodeGetDocumentOptions,
} from "./pdfjs-node-assets.ts";

test("pdfjs node asset urls are filesystem strings with a trailing slash", () => {
  const root = pdfjsDistRoot();
  const cmaps = pdfjsNodeAssetUrl("cmaps");
  const opts = pdfjsNodeGetDocumentOptions(new Uint8Array([1, 2, 3]));
  assert.equal(typeof root, "string");
  assert.equal(typeof cmaps, "string");
  assert.equal(typeof opts.cMapUrl, "string");
  assert.match(cmaps, /node_modules\/pdfjs-dist\/cmaps\/$/);
  assert.doesNotMatch(root, /^\d+$/);
  assert.doesNotMatch(cmaps, /^\d+$/);
  assert.equal(opts.cMapUrl, cmaps);
});
