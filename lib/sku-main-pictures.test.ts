import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assembleSkuMainPictures } from "./sku-main-pictures.ts";

describe("assembleSkuMainPictures", () => {
  it("uses the first image per SKU in specs order", () => {
    const urlByPath = new Map([
      ["a.png", "https://cdn/a.png"],
      ["a2.png", "https://cdn/a2.png"],
      ["b.png", "https://cdn/b.png"],
    ]);
    const pictures = assembleSkuMainPictures({
      skus: [
        { id: "a", name: "Green Apple" },
        { id: "b", name: "Watermelon" },
      ],
      imageRows: [
        { sku_id: "a", storage_path: "a.png" },
        { sku_id: "a", storage_path: "a2.png" },
        { sku_id: "b", storage_path: "b.png" },
      ],
      urlByPath,
    });
    assert.deepEqual(
      pictures.map((p) => ({ sku_id: p.sku_id, sku_name: p.sku_name, url: p.url })),
      [
        { sku_id: "a", sku_name: "Green Apple", url: "https://cdn/a.png" },
        { sku_id: "b", sku_name: "Watermelon", url: "https://cdn/b.png" },
      ]
    );
  });

  it("keeps leftover gallery sku_ids not in specs.skus", () => {
    const pictures = assembleSkuMainPictures({
      skus: [],
      imageRows: [{ sku_id: "x", storage_path: "x.png" }],
      urlByPath: new Map([["x.png", "https://cdn/x.png"]]),
    });
    assert.equal(pictures[0]?.sku_id, "x");
    assert.equal(pictures[0]?.sku_name, "SKU");
  });
});
