import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveWebhookItemMedia,
  skuArtworkRefs,
  type WebhookItemArtInput,
} from "./webhook-artwork.ts";

describe("skuArtworkRefs", () => {
  it("collects CRM image aliases, not only artwork_url", () => {
    const refs = skuArtworkRefs({
      sku_name: "ZOAP_PREROLL",
      image_url: "https://crm.example/zoap.png",
      images: ["https://crm.example/zoap-back.png"],
    });
    assert.equal(refs.length, 2);
    assert.equal(refs[0]?.url, "https://crm.example/zoap.png");
    assert.equal(refs[1]?.url, "https://crm.example/zoap-back.png");
  });
});

describe("resolveWebhookItemMedia", () => {
  const order = {
    artwork_url: "https://crm.example/all-labels.png",
    artwork_files: [
      { name: "ZOAP_PREROLL.png", url: "https://crm.example/zoap.png" },
      {
        name: "WHITE_WIDOW_PREROLL.png",
        url: "https://crm.example/widow.png",
      },
      { name: "PINK_ROSAY.png", url: "https://crm.example/pink.png" },
    ],
    skus: [
      {
        sku_name: "ZOAP_PREROLL",
        quantity: 12500,
        image_url: "https://crm.example/zoap.png",
      },
      {
        sku_name: "WHITE WIDOW_PREROLL",
        quantity: 12500,
        image_url: "https://crm.example/widow.png",
      },
    ],
  };

  it("assigns only the matching CRM pics to a split line item", () => {
    const zoap = resolveWebhookItemMedia(
      { title: "ZOAP_PREROLL" } satisfies WebhookItemArtInput,
      order,
      { jobTitle: "ZOAP_PREROLL", totalItems: 13 }
    );
    assert.equal(zoap.skus?.length, 1);
    assert.equal(zoap.skus?.[0]?.sku_name, "ZOAP_PREROLL");
    assert.deepEqual(
      (zoap.artwork_files ?? []).map((f) => f.url),
      ["https://crm.example/zoap.png"]
    );
    assert.equal(zoap.artwork_url, "https://crm.example/zoap.png");
  });

  it("does not copy the whole order gallery onto every card", () => {
    const widow = resolveWebhookItemMedia(
      { title: "WHITE WIDOW_PREROLL" } satisfies WebhookItemArtInput,
      order,
      { jobTitle: "WHITE WIDOW_PREROLL", totalItems: 13 }
    );
    assert.equal(widow.skus?.[0]?.sku_name, "WHITE WIDOW_PREROLL");
    assert.deepEqual(
      (widow.artwork_files ?? []).map((f) => f.url),
      ["https://crm.example/widow.png"]
    );
  });

  it("filters a duplicated full gallery on the item down to this line", () => {
    const item = resolveWebhookItemMedia(
      {
        title: "PINK ROSAY",
        artwork_files: order.artwork_files,
      },
      order,
      { jobTitle: "PINK ROSAY", totalItems: 13 }
    );
    assert.deepEqual(
      (item.artwork_files ?? []).map((f) => f.name),
      ["PINK_ROSAY.png"]
    );
  });

  it("keeps the full SKU list on a single-item order", () => {
    const one = resolveWebhookItemMedia(
      { title: "Safe Care" } satisfies WebhookItemArtInput,
      order,
      { jobTitle: "Safe Care", totalItems: 1 }
    );
    assert.equal(one.skus?.length, 2);
    assert.equal(one.artwork_files?.length, 3);
  });
});
