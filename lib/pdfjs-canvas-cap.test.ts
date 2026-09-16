import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capCanvasDims, PDFJS_MAX_CANVAS_EDGE } from "./pdfjs-canvas-cap.ts";

describe("capCanvasDims", () => {
  it("leaves small canvases alone", () => {
    const c = capCanvasDims(800, 600);
    assert.equal(c.w, 800);
    assert.equal(c.h, 600);
    assert.equal(c.scaleX, 1);
  });

  it("caps a flag-sized print image", () => {
    const c = capCanvasDims(28000, 9000);
    assert.ok(c.w <= PDFJS_MAX_CANVAS_EDGE);
    assert.ok(c.h <= PDFJS_MAX_CANVAS_EDGE);
    assert.ok(c.w * c.h <= PDFJS_MAX_CANVAS_EDGE * PDFJS_MAX_CANVAS_EDGE);
    assert.ok(c.scaleX < 1);
  });
});
