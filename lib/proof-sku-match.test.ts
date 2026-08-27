import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchProofsToSkus, versionToken } from "./proof-sku-match.ts";
import type { SkuItem } from "./skus.ts";

function file(name: string, id = name) {
  return { id, name, mimeType: "application/pdf", thumbnailLink: null };
}

function sku(id: string, name: string): SkuItem {
  return { id, name, qty: 1 };
}

describe("versionToken", () => {
  it("collapses SKU and proof filenames to the same token", () => {
    assert.equal(
      versionToken("Purus_2ozLabel_HM_Organic_Adrenal.pdf"),
      "adrenal"
    );
    assert.equal(versionToken("Adrenal"), "adrenal");
  });
});

describe("matchProofsToSkus", () => {
  it("matches a proof to a SKU by version name", () => {
    const result = matchProofsToSkus(
      [file("Purus_2ozLabel_HM_Organic_Adrenal.pdf")],
      [sku("s1", "Adrenal")]
    );
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0]?.skuId, "s1");
    assert.equal(result.unmatched.length, 0);
    assert.equal(result.unfilledSkus.length, 0);
  });

  it("matches using extra names such as webhook_item_title", () => {
    const result = matchProofsToSkus(
      [file("ZOAP_PREROLL.pdf")],
      [sku("s1", "Roll Labels – Silver BOPP")],
      "",
      { s1: ["ZOAP_PREROLL"] }
    );
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0]?.skuId, "s1");
    assert.equal(result.matches[0]?.file.name, "ZOAP_PREROLL.pdf");
  });

  it("assigns leftover job-folder files to a card with one SKU", () => {
    const result = matchProofsToSkus(
      [
        file("V5 Cizi Labels Dieline.pdf"),
        file("07-08-26 Cizi Brand VDP LABELS_No ID_PF.pdf"),
      ],
      [sku("s1", "Roll Labels – Silver BOPP (Aggressive Glue) – Matte Lamination")]
    );
    assert.equal(result.matches.length, 2);
    assert.ok(result.matches.every((m) => m.skuId === "s1"));
    assert.equal(result.unmatched.length, 0);
    assert.equal(result.unfilledSkus.length, 0);
  });

  it("does not dump leftover files onto a SKU that already matched a named proof", () => {
    const result = matchProofsToSkus(
      [
        file("ZOAP_PREROLL.pdf"),
        file("WHITE_WIDOW_PREROLL.pdf"),
        file("V5 Cizi Labels Dieline.pdf"),
      ],
      [sku("s1", "Roll Labels – Silver BOPP")],
      "",
      { s1: ["ZOAP_PREROLL"] }
    );
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0]?.file.name, "ZOAP_PREROLL.pdf");
    assert.equal(result.unmatched.length, 2);
  });

  it("matches CRACK DEN CAVIAR to caviar-crack-den filenames (any word order)", () => {
    const result = matchProofsToSkus(
      [
        file("caviar-crack-den-sticker-600dpi.png"),
        file("caviar-crack-den-spiral-600dpi.png"),
      ],
      [sku("s1", "CRACK DEN CAVIAR"), sku("s2", "THIS CAVIAR IS NOT")],
      "",
      {},
      { attachLeftovers: true }
    );
    assert.ok(
      result.matches.some(
        (m) =>
          m.skuId === "s1" &&
          m.file.name === "caviar-crack-den-sticker-600dpi.png"
      )
    );
    assert.equal(result.matches.length, 2);
    assert.equal(result.unfilledSkus.length, 0);
  });

  it("leaves unmatched files alone when the card has several SKUs", () => {
    const result = matchProofsToSkus(
      [file("shared-dieline.pdf")],
      [sku("s1", "Front"), sku("s2", "Back")]
    );
    assert.equal(result.matches.length, 0);
    assert.equal(result.unmatched.length, 1);
    assert.equal(result.unfilledSkus.length, 2);
  });
});
