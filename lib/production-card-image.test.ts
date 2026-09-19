import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { productionCardImageMeta } from "./production-card-image.ts";

describe("productionCardImageMeta", () => {
  it("labels PNG bytes as PNG, not JPEG", () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("rest"),
    ]);
    assert.deepEqual(productionCardImageMeta(png), {
      fileName: "final-production.png",
      contentType: "image/png",
    });
  });

  it("labels JPEG bytes as JPEG", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    assert.deepEqual(productionCardImageMeta(jpeg), {
      fileName: "final-production.jpg",
      contentType: "image/jpeg",
    });
  });
});
