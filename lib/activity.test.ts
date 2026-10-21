import assert from "node:assert/strict";
import test from "node:test";
import {
  formatStayDuration,
  isColumnMoveActivity,
  isVisibleCustomerReplyActivity,
  latestSentToForNotification,
  mergeActivityById,
  resolveActivityActorName,
  sendsForNotification,
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

test("card chat icon follows Com. History client replies, not outbound SMS", () => {
  assert.equal(
    isVisibleCustomerReplyActivity(activity("customer_replied")),
    true
  );
  assert.equal(
    isVisibleCustomerReplyActivity(activity("info_submitted")),
    true
  );
  assert.equal(
    isVisibleCustomerReplyActivity(
      activity("approved", null, { movedTo: "col-2" })
    ),
    false
  );
  assert.equal(isVisibleCustomerReplyActivity(activity("texted")), false);
  assert.equal(
    isVisibleCustomerReplyActivity(activity("customer_notified")),
    false
  );
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

// 15504-1 (2026-10-20): same approval notification sent SMS-only by Marianna,
// then Email + SMS by Davit. The timeline is newest-first; "To:" showed only
// the phone because the oldest log was picked.
function sentLog(
  id: string,
  createdAt: string,
  actorName: string,
  metadata: Record<string, unknown>
) {
  return {
    id,
    tenant_id: "tenant-id",
    order_id: "order-id",
    actor: null,
    action: "customer_notified",
    metadata,
    created_at: createdAt,
    actor_name: actorName,
  };
}

const newestFirst = [
  sentLog("c", "2026-10-21T05:37:06Z", "Davit", {
    notificationId: "n1",
    channel: "both",
    phone: "+18188569944",
    recipients: ["safecarepackaging@gmail.com"],
  }),
  sentLog("b", "2026-10-20T23:02:49Z", "Marianna", {
    notificationId: "n1",
    channel: "sms",
    phone: "+18188569944",
  }),
  sentLog("a", "2026-10-20T22:42:44Z", "Marianna", {
    notificationId: "n0",
    channel: "sms",
    phone: "+18188569944",
  }),
];

test("latest send for a reused notification shows both recipients", () => {
  const latest = latestSentToForNotification(newestFirst, "n1");
  assert.equal(latest?.email, "safecarepackaging@gmail.com");
  assert.equal(latest?.phone, "+18188569944");
  assert.equal(
    latest?.line,
    "safecarepackaging@gmail.com · +18188569944"
  );
  // Order of the input must not matter.
  const oldestFirst = [...newestFirst].reverse();
  assert.equal(
    latestSentToForNotification(oldestFirst, "n1")?.line,
    "safecarepackaging@gmail.com · +18188569944"
  );
});

test("sendsForNotification lists every send with the channels used", () => {
  const sends = sendsForNotification([...newestFirst].reverse(), "n1");
  assert.deepEqual(
    sends.map((s) => [s.actor_name, s.channel, s.line]),
    [
      [
        "Davit",
        "both",
        "Email safecarepackaging@gmail.com · SMS +18188569944",
      ],
      ["Marianna", "sms", "SMS +18188569944"],
    ]
  );
});
