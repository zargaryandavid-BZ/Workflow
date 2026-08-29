import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  categoryForProduct,
  isCatchAllCategory,
} from "./product-data.ts";

describe("categoryForProduct", () => {
  it("maps CRM apparel product names to Apparel, not Other", () => {
    assert.equal(categoryForProduct("Premium Heavy Tee"), "Apparel");
    assert.equal(categoryForProduct("Promo Hoodie"), "Apparel");
    assert.equal(
      categoryForProduct("Premium Heavy Tee", { Other: ["Premium Heavy Tee"] }),
      "Apparel"
    );
  });

  it("prefers the catalog Apparel bucket over Other", () => {
    assert.equal(
      categoryForProduct("Premium Heavy Tee", {
        Other: ["Premium Heavy Tee"],
        Apparel: ["Premium Heavy Tee", "Hoodie"],
      }),
      "Apparel"
    );
  });

  it("keeps known static products", () => {
    assert.equal(categoryForProduct("Labels (Roll)"), "Labels & Stickers");
    assert.equal(categoryForProduct("Other"), "Other");
  });
});

describe("isCatchAllCategory", () => {
  it("treats Other as a placeholder", () => {
    assert.equal(isCatchAllCategory("Other"), true);
    assert.equal(isCatchAllCategory("Apparel"), false);
  });
});
