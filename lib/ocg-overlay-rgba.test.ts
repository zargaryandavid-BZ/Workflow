import assert from "node:assert/strict";
import { test } from "node:test";
import { ocgOverlayRgba } from "./ocg-overlay-rgba.ts";

test("ocgOverlayRgba clears pixels that match the base artwork", () => {
  const full = Uint8Array.of(10, 20, 30, 255, 200, 10, 10, 255);
  const base = Uint8Array.of(10, 20, 30, 255, 0, 0, 0, 255);
  const out = ocgOverlayRgba(full, base, 12);
  assert.deepEqual([...out.slice(0, 4)], [0, 0, 0, 0]);
  assert.deepEqual([...out.slice(4, 8)], [200, 10, 10, 255]);
});
