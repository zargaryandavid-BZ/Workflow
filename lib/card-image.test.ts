import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseCardImageRef,
  preferCardImage,
  preserveCardImage,
} from "./card-image.ts";

describe("parseCardImageRef", () => {
  it("reads a stored card_image ref", () => {
    assert.deepEqual(
      parseCardImageRef({
        card_image: { source: "sku_image", id: "img-1" },
      }),
      { source: "sku_image", id: "img-1" }
    );
  });

  it("rejects incomplete refs", () => {
    assert.equal(parseCardImageRef({ card_image: { source: "sku_image" } }), null);
    assert.equal(parseCardImageRef({}), null);
  });
});

describe("preferCardImage", () => {
  const items = [
    { source: "sku_image" as const, id: "a", url: "a.jpg" },
    { source: "asset" as const, id: "b", url: "b.jpg" },
  ];

  it("moves the chosen picture to the front", () => {
    const next = preferCardImage(items, { source: "asset", id: "b" });
    assert.equal(next[0]?.id, "b");
    assert.equal(next[1]?.id, "a");
  });

  it("leaves order alone when the choice is already first", () => {
    const next = preferCardImage(items, { source: "sku_image", id: "a" });
    assert.equal(next[0]?.id, "a");
  });
});

describe("preserveCardImage", () => {
  const saved = { card_image: { source: "sku_image", id: "img-1" } };

  it("keeps the saved picture when a specs patch omits it", () => {
    const next = preserveCardImage(saved, { skus: [] });
    assert.deepEqual(next.card_image, saved.card_image);
  });

  it("allows an explicit new picture", () => {
    const next = preserveCardImage(saved, {
      card_image: { source: "asset", id: "other" },
    });
    assert.deepEqual(next.card_image, { source: "asset", id: "other" });
  });
});
