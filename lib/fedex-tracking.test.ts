import assert from "node:assert/strict";
import { test } from "node:test";
import { fedexTrackingUrl } from "./fedex-tracking.ts";

test("fedexTrackingUrl uses the public wtrk track page", () => {
  assert.equal(
    fedexTrackingUrl("878071227975"),
    "https://www.fedex.com/wtrk/track/?trknbr=878071227975"
  );
});

test("fedexTrackingUrl trims and encodes the number", () => {
  assert.equal(
    fedexTrackingUrl(" 12 34 "),
    "https://www.fedex.com/wtrk/track/?trknbr=12%2034"
  );
  assert.equal(fedexTrackingUrl("  "), "");
});
