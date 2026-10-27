import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildShippingStatusItems,
  shippingStatusKindForColumnName,
  shouldAutoRemoveShippingStatus,
  splitShippingStatusItems,
  type ShippingStatusRow,
} from "./shipping-status.ts";

function row(
  id: string,
  orderId: string,
  choice: "pickup" | "delivery",
  respondedAt: string,
  overrides: Partial<ShippingStatusRow> = {}
): ShippingStatusRow {
  return {
    id,
    order_id: orderId,
    status: "client_responded",
    client_choice: choice,
    fedex_selection:
      choice === "delivery"
        ? {
            serviceType: "FEDEX_GROUND",
            serviceName: "FedEx Ground",
            totalCharge: 20,
            currency: "USD",
            deliveryDate: null,
            transitDays: null,
          }
        : null,
    delivery_address: null,
    fedex_tracking_number: null,
    responded_at: respondedAt,
    created_at: respondedAt,
    shipping_status_seen_at: null,
    shipping_status_removed_at: null,
    order: {
      id: orderId,
      title: `ORDER-${orderId}`,
      specs: {},
      column: { name: choice === "pickup" ? "Pickups " : "To be Shipped " },
      customer: { name: `Customer ${orderId}` },
    },
    ...overrides,
  };
}

describe("shipping status dashboard rows", () => {
  it("sorts newest first, classifies columns, and marks unseen responses new", () => {
    const items = buildShippingStatusItems([
      row("pickup-1", "1", "pickup", "2026-10-20T10:00:00.000Z", {
        shipping_status_seen_at: "2026-10-20T11:00:00.000Z",
      }),
      row("delivery-1", "2", "delivery", "2026-10-21T10:00:00.000Z", {
        fedex_tracking_number: "TRACK-2",
      }),
    ]);
    const split = splitShippingStatusItems(items);

    assert.deepEqual(
      items.map((item) => item.id),
      ["delivery-1", "pickup-1"]
    );
    assert.equal(split.pickup[0]?.isNew, false);
    assert.equal(split.delivery[0]?.isNew, true);
    assert.equal(split.delivery[0]?.trackingNumber, "TRACK-2");
  });

  it("uses only the latest response for an order", () => {
    const items = buildShippingStatusItems([
      row("older-pickup", "1", "pickup", "2026-10-20T10:00:00.000Z"),
      row("new-delivery", "1", "delivery", "2026-10-21T10:00:00.000Z"),
    ]);

    assert.equal(items.length, 1);
    assert.equal(items[0]?.id, "new-delivery");
    assert.equal(items[0]?.kind, "delivery");
  });

  it("does not reveal an older response when the latest was removed", () => {
    const items = buildShippingStatusItems([
      row("older", "1", "pickup", "2026-10-20T10:00:00.000Z"),
      row("latest", "1", "delivery", "2026-10-21T10:00:00.000Z", {
        shipping_status_removed_at: "2026-10-22T10:00:00.000Z",
      }),
    ]);

    assert.deepEqual(items, []);
  });

  it("only includes responses whose order is in the matching status column", () => {
    const wrongColumn = row(
      "pickup-in-shipping",
      "1",
      "pickup",
      "2026-10-20T10:00:00.000Z",
      {
        order: {
          id: "1",
          title: "ORDER-1",
          specs: {},
          column: { name: "To be Shipped " },
          customer: { name: "Customer 1" },
        },
      }
    );

    assert.deepEqual(buildShippingStatusItems([wrongColumn]), []);
  });

  it("recognizes only the Pickup and To be Shipped columns", () => {
    assert.equal(shippingStatusKindForColumnName("Pickups "), "pickup");
    assert.equal(shippingStatusKindForColumnName("To be Shipped "), "delivery");
    assert.equal(shippingStatusKindForColumnName("Ready to Ship"), null);
  });
});

describe("shipping status automatic removal", () => {
  it("removes pickup only after pickup confirmation", () => {
    assert.equal(
      shouldAutoRemoveShippingStatus({
        choice: "pickup",
        event: "pickup_confirmed",
      }),
      true
    );
    assert.equal(
      shouldAutoRemoveShippingStatus({
        choice: "delivery",
        event: "pickup_confirmed",
      }),
      false
    );
  });

  it("removes delivery only after entering a fulfilled scan stage", () => {
    assert.equal(
      shouldAutoRemoveShippingStatus({
        choice: "delivery",
        event: "entered_fulfilled",
      }),
      true
    );
    assert.equal(
      shouldAutoRemoveShippingStatus({
        choice: "pickup",
        event: "entered_fulfilled",
      }),
      false
    );
  });
});
