import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCatalogReviewToOptions,
  clusterNeedsReview,
  mergeFieldOptions,
  optionsAreDuplicates,
  parseCatalogPayload,
} from "./import-catalog.ts";

describe("applyCatalogReviewToOptions", () => {
  it("keeps user-selected labels and drops the rest of the cluster", () => {
    const options = applyCatalogReviewToOptions({
      existing: [
        "Clear BOPP",
        "Clear Label (Clear BOPP)",
        "Custom Only",
        "White BOPP",
      ],
      groups: [
        {
          ours: ["Clear BOPP", "Clear Label (Clear BOPP)"],
          catalog: ["Clear Label (Clear BOPP)"],
          keep: ["Clear Label (Clear BOPP)"],
        },
      ],
      add: ["New Mat"],
    });
    assert.deepEqual(options, [
      "Custom Only",
      "White BOPP",
      "Clear Label (Clear BOPP)",
      "New Mat",
    ]);
  });

  it("can keep both ours and catalog when selected", () => {
    const options = applyCatalogReviewToOptions({
      existing: ["Roll Labels", "Unique"],
      groups: [
        {
          ours: ["Roll Labels"],
          catalog: ["Labels (Roll)"],
          keep: ["Roll Labels", "Labels (Roll)"],
        },
      ],
      add: [],
    });
    assert.deepEqual(options, ["Unique", "Roll Labels", "Labels (Roll)"]);
  });
});


describe("parseCatalogPayload", () => {
  it("parses Shape B (reshaped)", () => {
    const lists = parseCatalogPayload({
      categories: ["Labels"],
      productsByCategory: { Labels: ["Roll Labels", "Sheet Labels"] },
      materialsByProduct: {
        "Roll Labels": ["White BOPP", "Clear BOPP"],
        "Sheet Labels": ["White BOPP"],
      },
    });
    assert.deepEqual(lists.categories, ["Labels"]);
    assert.deepEqual(lists.products, ["Roll Labels", "Sheet Labels"]);
    assert.deepEqual(lists.materials, ["White BOPP", "Clear BOPP"]);
  });

  it("parses Shape A (CRM raw)", () => {
    const lists = parseCatalogPayload({
      categories: [
        { id: 1, name: "Apparel", sort_order: 0, parent_id: null },
        { id: 2, name: "Tees", sort_order: 1, parent_id: 1 },
      ],
      products: [
        {
          name: "Tee",
          category_id: 2,
          material_groups: [
            { materials: [{ name: "Cotton" }, { name: "Cotton" }] },
          ],
        },
      ],
    });
    assert.deepEqual(lists.categories, ["Apparel", "Tees"]);
    assert.deepEqual(lists.products, ["Tee"]);
    assert.deepEqual(lists.materials, ["Cotton"]);
  });
});

describe("optionsAreDuplicates", () => {
  it("matches BOPP label synonyms", () => {
    assert.equal(
      optionsAreDuplicates("Clear BOPP", "Clear Label (Clear BOPP)"),
      true
    );
    assert.equal(
      optionsAreDuplicates("White BOPP", "White Label (White BOPP)"),
      true
    );
    assert.equal(
      optionsAreDuplicates(
        "Silver BOPP",
        "Silver / Metallic Label (Silver BOPP)"
      ),
      true
    );
    assert.equal(
      optionsAreDuplicates(
        "Holo BOPP",
        "Holographic Label (Rainbow Holographic BOPP)"
      ),
      true
    );
    assert.equal(optionsAreDuplicates("Holo BOPP", "Holographic Vinyl"), true);
  });

  it("matches cosmetic web to BOPP color", () => {
    assert.equal(
      optionsAreDuplicates("Clear Cosmetic Web", "Clear BOPP"),
      true
    );
    assert.equal(
      optionsAreDuplicates("White Cosmetic Web", "White BOPP"),
      true
    );
  });

  it("matches generic cardstock to specific pt, not C1S to C2S", () => {
    assert.equal(optionsAreDuplicates("14pt Cardstock", "14pt C1S"), true);
    assert.equal(optionsAreDuplicates("14pt Cardstock", "14pt C2S"), true);
    assert.equal(optionsAreDuplicates("14pt C1S", "14pt C2S"), false);
    assert.equal(optionsAreDuplicates("18pt Cardstock", "18pt (Boyd)"), true);
  });

  it("matches self-adhesive and semi-gloss and pouch typos", () => {
    assert.equal(
      optionsAreDuplicates(
        "Self-Adhesive (Peel-and-Stick)",
        "Self-Adhesive Wallpaper (Peel & Stick)"
      ),
      true
    );
    assert.equal(
      optionsAreDuplicates("Semi Gloss", "Semi-Gloss Paper Label"),
      true
    );
    assert.equal(
      optionsAreDuplicates("Pouche One sided", "Pouch One sided"),
      true
    );
  });

  it("matches strong product near-duplicates (~90% text), not loose synonyms", () => {
    assert.equal(
      optionsAreDuplicates("Backlit Film", "Backlit Film Printing"),
      true
    );
    assert.equal(optionsAreDuplicates("Menus", "Menu"), true);
    assert.equal(optionsAreDuplicates("Roll Labels", "Labels (Roll)"), true);
    assert.equal(
      optionsAreDuplicates("Die Cut / Kiss Cut Stickers", "Diecut Stickers"),
      true
    );
    assert.equal(
      optionsAreDuplicates(
        "Premium Trading Cards",
        "Premium Trading Cards (Scodix)"
      ),
      true
    );

    // Related products, not the same option
    assert.equal(
      optionsAreDuplicates("Diecut Stickers", "Individual Stickers"),
      false
    );
    assert.equal(
      optionsAreDuplicates("Sticker Sheets", "Labels (Sheet)"),
      false
    );
    assert.equal(
      optionsAreDuplicates("Wallpaper", "Custom Wallpaper Rolls"),
      false
    );
    assert.equal(
      optionsAreDuplicates("Custom Poly Tape", "Custom Packaging Tape"),
      false
    );
    assert.equal(
      optionsAreDuplicates("Vinyl Banners", "Banners / Large Format"),
      false
    );
    assert.equal(
      optionsAreDuplicates("Vinyl Signage", "Sign board"),
      false
    );
    assert.equal(
      optionsAreDuplicates("Custom printed paper bags", "Gift Bags"),
      false
    );
    assert.equal(
      optionsAreDuplicates("Standard Trading Cards", "Premium Trading Cards"),
      false
    );
    assert.equal(
      optionsAreDuplicates("Custom Wallpaper Rolls", "Roll Labels"),
      false
    );
  });

  it("matches product parent catch-alls to specifics, not sibling specifics", () => {
    assert.equal(
      optionsAreDuplicates("Jar Combo", "1oz Jar + Label Combo"),
      true
    );
    assert.equal(
      optionsAreDuplicates("1oz Jar + Label Combo", "2oz Jar + Label Combo"),
      false
    );
    assert.equal(
      optionsAreDuplicates("Tube Only", "Chubby Gorilla Tube + Label Combo"),
      true
    );
    assert.equal(
      optionsAreDuplicates("Pouches Combo", "Stand Up Pouches"),
      true
    );
    assert.equal(
      optionsAreDuplicates("Stand Up Pouches", "Lay Flat Pouches"),
      false
    );
    assert.equal(
      optionsAreDuplicates("Tuck end box", "Mini Tuck End Box"),
      true
    );
    assert.equal(
      optionsAreDuplicates("Mini Tuck End Box", "Cartridge Tuck End Box"),
      false
    );
    assert.equal(optionsAreDuplicates("Apparel", "Leggings"), true);
    assert.equal(optionsAreDuplicates("Leggings", "Promo Hoodie"), false);
  });
});

describe("mergeFieldOptions", () => {
  it("keeps manual-only options and adds new catalog ones", () => {
    const { options, added } = mergeFieldOptions(
      ["Custom Mat", "White BOPP"],
      ["Clear BOPP"]
    );
    assert.equal(added, 1);
    assert.ok(options.includes("Custom Mat"));
    assert.ok(options.includes("White BOPP"));
    assert.ok(options.includes("Clear BOPP"));
  });

  it("overwrites matching options with catalog spelling", () => {
    const { options, overwritten } = mergeFieldOptions(
      ["Custom Mat", "white bopp"],
      ["White BOPP", "Clear BOPP"]
    );
    assert.ok(overwritten >= 1);
    assert.deepEqual(
      options.filter((o) => /bopp/i.test(o) || o === "Custom Mat"),
      ["White BOPP", "Clear BOPP", "Custom Mat"]
    );
  });

  it("collapses near-duplicates to catalog URL text", () => {
    const { options } = mergeFieldOptions(
      [
        "Clear BOPP",
        "Clear Label (Clear BOPP)",
        "White Cosmetic Web",
        "14pt Cardstock",
        "14pt C1S",
        "Semi Gloss",
        "Custom Only",
      ],
      [
        "Clear Label (Clear BOPP)",
        "White BOPP",
        "14pt C1S",
        "14pt C2S",
        "Semi-Gloss Paper Label",
      ]
    );

    assert.ok(options.includes("Clear Label (Clear BOPP)"));
    assert.ok(!options.includes("Clear BOPP"));
    assert.ok(options.includes("White BOPP"));
    assert.ok(!options.includes("White Cosmetic Web"));
    assert.ok(options.includes("14pt C1S"));
    assert.ok(options.includes("14pt C2S"));
    assert.ok(!options.includes("14pt Cardstock"));
    assert.ok(options.includes("Semi-Gloss Paper Label"));
    assert.ok(!options.includes("Semi Gloss"));
    assert.ok(options.includes("Custom Only"));
  });

  it("collapses product duplicates to catalog URL text", () => {
    const { options } = mergeFieldOptions(
      [
        "Menus",
        "Labels (Roll)",
        "Jar Combo",
        "1oz Jar + Label Combo",
        "Tuck end box",
        "Mini Tuck End Box",
        "Apparel",
        "Unique Product",
      ],
      [
        "Menu",
        "Roll Labels",
        "1oz Jar + Label Combo",
        "2oz Jar + Label Combo",
        "Mini Tuck End Box",
        "Cartridge Tuck End Box",
        "Leggings",
      ]
    );

    assert.ok(options.includes("Menu"));
    assert.ok(!options.includes("Menus"));
    assert.ok(options.includes("Roll Labels"));
    assert.ok(!options.includes("Labels (Roll)"));
    assert.ok(options.includes("1oz Jar + Label Combo"));
    assert.ok(options.includes("2oz Jar + Label Combo"));
    assert.ok(!options.includes("Jar Combo"));
    assert.ok(options.includes("Mini Tuck End Box"));
    assert.ok(options.includes("Cartridge Tuck End Box"));
    assert.ok(!options.includes("Tuck end box"));
    assert.ok(options.includes("Leggings"));
    assert.ok(!options.includes("Apparel"));
    assert.ok(options.includes("Unique Product"));
  });
});

describe("clusterNeedsReview", () => {
  it("hides identical imported/ours pairs", () => {
    assert.equal(
      clusterNeedsReview({
        ours: ["Apparel", "Leggings"],
        catalog: ["Apparel", "Leggings"],
      }),
      false
    );
  });

  it("shows real spelling conflicts", () => {
    assert.equal(
      clusterNeedsReview({
        ours: ["Menus"],
        catalog: ["Menu"],
      }),
      true
    );
    assert.equal(
      clusterNeedsReview({
        ours: ["Clear BOPP"],
        catalog: ["Clear Label (Clear BOPP)"],
      }),
      true
    );
  });
});
