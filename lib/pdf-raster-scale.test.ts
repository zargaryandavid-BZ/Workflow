import assert from "node:assert/strict";
import test from "node:test";
import {
  JOB_TICKET_RASTER_DPI,
  JOB_TICKET_RASTER_MAX_EDGE,
  rasterScaleForPdfPage,
} from "./pdf-raster-scale.ts";

test("small sticker pages scale up to target DPI", () => {
  const scale = rasterScaleForPdfPage(216, 216, {
    maxEdge: JOB_TICKET_RASTER_MAX_EDGE,
    targetDpi: JOB_TICKET_RASTER_DPI,
  });
  assert.ok(scale > 2.5);
  assert.ok(216 * scale <= JOB_TICKET_RASTER_MAX_EDGE);
});

test("large artboards are capped on the longest edge", () => {
  const scale = rasterScaleForPdfPage(4000, 4000, {
    maxEdge: JOB_TICKET_RASTER_MAX_EDGE,
    targetDpi: JOB_TICKET_RASTER_DPI,
  });
  assert.equal(Math.round(4000 * scale), JOB_TICKET_RASTER_MAX_EDGE);
});
