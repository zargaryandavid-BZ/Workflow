import assert from "node:assert/strict";
import test from "node:test";
import { resolveActivityActorName } from "./activity.ts";

type TestActivity = Parameters<typeof resolveActivityActorName>[0];

function activity(
  action: string,
  actor: string | null = null,
  metadata: Record<string, unknown> = {}
): TestActivity {
  return {
    id: "activity-id",
    tenant_id: "tenant-id",
    order_id: "order-id",
    actor,
    action,
    metadata,
    created_at: "2026-08-18T00:00:00.000Z",
  };
}

test("uses the authenticated staff profile when an actor is stored", () => {
  assert.equal(
    resolveActivityActorName(
      activity("moved", "user-id"),
      new Map([["user-id", "Gary"]])
    ),
    "Gary"
  );
});

test("recovers historical notification senders from the notification row", () => {
  assert.equal(
    resolveActivityActorName(
      activity("customer_notified", null, {
        notificationId: "notification-id",
      }),
      new Map([["user-id", "Marianna"]]),
      new Map([["notification-id", "user-id"]])
    ),
    "Marianna"
  );
});

test("labels customer, automation, webhook, warehouse, and system activity", () => {
  const names = new Map<string, string>();
  assert.equal(
    resolveActivityActorName(activity("customer_replied"), names),
    "Customer"
  );
  assert.equal(
    resolveActivityActorName(
      activity("texted", null, { source: "notification_rule" }),
      names
    ),
    "Automation"
  );
  assert.equal(
    resolveActivityActorName(
      activity("created", null, { source: "webhook" }),
      names
    ),
    "Webhook"
  );
  assert.equal(
    resolveActivityActorName(
      activity("warehouse_stock_confirmed", null, {
        source: "sms_link",
        confirmedBy: "Alex",
      }),
      names
    ),
    "Alex"
  );
  assert.equal(resolveActivityActorName(activity("customer_merged"), names), "System");
});
