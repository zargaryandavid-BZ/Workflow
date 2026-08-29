import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  catalogPageCursor,
  catalogUrlWithCursor,
  mergeCatalogPages,
} from "./import-catalog-fetch.ts";

describe("catalogPageCursor", () => {
  it("reads next_cursor and ignores empty/null", () => {
    assert.equal(
      catalogPageCursor({ next_cursor: "black-cherry-box-dieline" }),
      "black-cherry-box-dieline"
    );
    assert.equal(catalogPageCursor({ next_cursor: null }), null);
    assert.equal(catalogPageCursor({ next_cursor: "null" }), null);
    assert.equal(catalogPageCursor({ products: [] }), null);
  });
});

describe("catalogUrlWithCursor", () => {
  it("sets cursor on the original catalog URL", () => {
    const base = new URL("https://prod-bazaar-crm.vercel.app/api/public/v1/catalog");
    const next = catalogUrlWithCursor(base, "black-cherry-box-dieline");
    assert.equal(
      next.searchParams.get("cursor"),
      "black-cherry-box-dieline"
    );
    assert.equal(base.searchParams.get("cursor"), null);
  });
});

describe("mergeCatalogPages", () => {
  it("concatenates paginated products and clears next_cursor", () => {
    const merged = mergeCatalogPages([
      {
        schema_version: 2,
        count: 200,
        total_matching: 208,
        next_cursor: "black-cherry-box-dieline",
        products: [
          { id: "pouches-combo", name: "Pouches Combo" },
          { id: "sandwich-wrapping-paper", name: "Sandwich Wrapping Paper" },
        ],
      },
      {
        schema_version: 2,
        count: 8,
        total_matching: 208,
        next_cursor: null,
        products: [
          { id: "kream-jar-box", name: "Kream Jar Box" },
          { id: "sandwich-wrapping-paper", name: "Sandwich Wrapping Paper" },
        ],
      },
    ]) as {
      products: { id: string; name: string }[];
      count: number;
      next_cursor: null;
    };

    assert.equal(merged.count, 3);
    assert.equal(merged.next_cursor, null);
    assert.deepEqual(
      merged.products.map((p) => p.name),
      ["Pouches Combo", "Sandwich Wrapping Paper", "Kream Jar Box"]
    );
  });
});
