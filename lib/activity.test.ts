import assert from "node:assert/strict";
import test from "node:test";
import {
  formatStayDuration,
  isColumnMoveActivity,
  mergeActivityById,
  resolveActivityActorName,
} from "./activity.ts";

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

test("treats staff, automation, approval, and customer-reply column changes as moves", () => {
  assert.equal(isColumnMoveActivity(activity("moved")), true);
  assert.equal(isColumnMoveActivity(activity("idle_auto_moved")), true);
  assert.equal(
    isColumnMoveActivity(activity("approved", null, { movedTo: "col-2" })),
    true
  );
  assert.equal(
    isColumnMoveActivity(activity("customer_replied", null, { toName: "Hold" })),
    true
  );
  assert.equal(
    isColumnMoveActivity(
      activity("customer_replied", null, { type: "ready_to_ship" })
    ),
    false
  );
  assert.equal(isColumnMoveActivity(activity("created")), false);
});

test("formats stay duration with leftover hours and minutes", () => {
  assert.equal(formatStayDuration(43 * 60_000), "43m");
  assert.equal(formatStayDuration(90 * 60_000), "1h 30m");
  assert.equal(formatStayDuration(26 * 60 * 60_000), "1d 2h");
});

test("mergeActivityById keeps unique rows", () => {
  const a = activity("moved");
  const b = { ...activity("updated"), id: "other" };
  assert.equal(mergeActivityById([a], [a, b]).length, 2);
});
