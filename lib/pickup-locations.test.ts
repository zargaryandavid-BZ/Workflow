import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  formatPickupAddressLine,
  formatPickupNotifyLocation,
  parsePickupLocationDrafts,
} from "./pickup-locations.ts";

describe("formatPickupAddressLine", () => {
  test("joins street and city line", () => {
    assert.equal(
      formatPickupAddressLine({
        street: "306 Boyd St",
        city: "Los Angeles",
        state: "CA",
        zip: "90013",
      }),
      "306 Boyd St, Los Angeles, CA 90013"
    );
  });
});

describe("formatPickupNotifyLocation", () => {
  test("prefixes a distinct name", () => {
    assert.equal(
      formatPickupNotifyLocation({
        name: "Warehouse",
        street: "100 Main St",
        city: "Los Angeles",
        state: "CA",
        zip: "90012",
      }),
      "Warehouse — 100 Main St, Los Angeles, CA 90012"
    );
  });
});

describe("parsePickupLocationDrafts", () => {
  test("requires exactly one FedEx origin", () => {
    const { error } = parsePickupLocationDrafts([
      {
        name: "A",
        street: "1 A St",
        city: "LA",
        state: "CA",
        zip: "90013",
        hours_note: "",
        use_for_fedex: false,
      },
      {
        name: "B",
        street: "2 B St",
        city: "LA",
        state: "CA",
        zip: "90014",
        hours_note: "",
        use_for_fedex: false,
      },
    ]);
    assert.equal(error, "Check exactly one location for FedEx rate calculation");
  });

  test("accepts one FedEx-checked location", () => {
    const { drafts, error } = parsePickupLocationDrafts([
      {
        name: "Shop",
        street: "306 Boyd St",
        city: "Los Angeles",
        state: "CA",
        zip: "90013",
        hours_note: "Mon–Fri",
        use_for_fedex: true,
      },
    ]);
    assert.equal(error, null);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].use_for_fedex, true);
  });
});
