import { test } from "node:test";
import assert from "node:assert/strict";

import { brandTenantName, emailBrandFromSpecs, rebrandText } from "./email-brand.ts";

test("emailBrandFromSpecs reads specs.brand (object or JSON string)", () => {
  assert.equal(emailBrandFromSpecs({ brand: "PIXELPRESS" }), "PIXELPRESS");
  assert.equal(emailBrandFromSpecs({ brand: "pixelpress" }), "PIXELPRESS");
  assert.equal(emailBrandFromSpecs(JSON.stringify({ brand: "PIXELPRESS" })), "PIXELPRESS");
  assert.equal(emailBrandFromSpecs({}), "BAZAAR");
  assert.equal(emailBrandFromSpecs(null), "BAZAAR");
  assert.equal(emailBrandFromSpecs("not json"), "BAZAAR");
});

test("rebrandText swaps Bazaar details only for Pixel Press", () => {
  const sig =
    "Thanks — Bazaar Printing Team\n(+1) 747 348 4444 | info@bazaarprinting.com\n306 Boyd St, Los Angeles, CA 90013\nOrder online: www.bazaarprinting.com\nhttps://bazaarprinting.com/assets/Bazaar.png\nhttps://bazaarprinting.com/approve/abc";
  const pp = rebrandText(sig, "PIXELPRESS");
  assert.match(pp, /Pixel Press Print Team/);
  assert.match(pp, /\(\+1\) 213 770 4777 \| info@pixelpressprint\.com/);
  assert.match(pp, /1025 E 16th St, Los Angeles, CA 90021/);
  assert.match(pp, /www\.pixelpressprint\.com/);
  assert.match(pp, /pixelpress-horizontal\.png/);
  assert.doesNotMatch(pp, /Bazaar Printing|747 348 4444|306 Boyd/);
  // links/tokens are untouched
  assert.match(pp, /https:\/\/bazaarprinting\.com\/approve\/abc/);
  assert.equal(rebrandText(sig, "BAZAAR"), sig);
  assert.equal(rebrandText(sig, undefined), sig);
});

test("brandTenantName", () => {
  assert.equal(brandTenantName("PIXELPRESS", "Bazaar Printing"), "Pixel Press Print");
  assert.equal(brandTenantName("BAZAAR", "Bazaar Printing"), "Bazaar Printing");
  assert.equal(brandTenantName(undefined, "Bazaar Printing"), "Bazaar Printing");
});
