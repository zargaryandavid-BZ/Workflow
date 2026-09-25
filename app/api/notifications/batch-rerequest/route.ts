import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  dispatchNotification,
  NOTIFICATION_TOKEN_TTL_MS,
} from "@/lib/notifications";
import type { JobNotification, Order } from "@/lib/types";

export const maxDuration = 300;

/** An order eligible for batch re-request. */
export interface BatchRerequestOrder {
  orderId: string;
  title: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  /** "never_sent" = no approval notification sent yet; "stale" = sent but overdue. */
  reason: "never_sent" | "stale";
  /** ISO timestamp of the last sent approval notification (null if never sent). */
  lastSentAt: string | null;
  /** Existing notification id to re-dispatch (null for never_sent). */
  notificationId: string | null;
  /** Channel to use for re-dispatch (null for never_sent). */
  channel: string | null;
}

/**
 * GET /api/notifications/batch-rerequest?columnId=X&staleDays=2
 *
 * Returns the orders in the given column that are eligible for batch
 * approval re-request, split into "never_sent" and "stale" categories.
 */
export async function GET(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const columnId = searchParams.get("columnId");
  const staleDays = Math.max(1, Number(searchParams.get("staleDays") ?? "2"));

  if (!columnId) {
    return NextResponse.json({ error: "columnId is required" }, { status: 400 });
  }

  const supabase = await createClient();

  // Fetch orders in column with customer info
  const { data: orders, error: ordersErr } = await supabase
    .from("orders")
    .select("id, title, customer:customers(name, email, phone)")
    .eq("tenant_id", ctx.tenant.id)
    .eq("column_id", columnId)
    .is("removed_at", null);

  if (ordersErr) return NextResponse.json({ error: ordersErr.message }, { status: 500 });
  if (!orders || orders.length === 0) {
    return NextResponse.json({ eligible: [] });
  }

  const orderIds = orders.map((o) => o.id);

  // Fetch latest sent/pending approval notifications for these orders
  const { data: notifications } = await supabase
    .from("job_notifications")
    .select("id, order_id, status, channel, created_at")
    .eq("tenant_id", ctx.tenant.id)
    .eq("type", "customer_approval")
    .in("order_id", orderIds)
    .in("status", ["sent", "pending"])
    .order("created_at", { ascending: false });

  // Latest sent notification per order
  const latestSentByOrder = new Map<
    string,
    { id: string; created_at: string; channel: string }
  >();
  for (const n of notifications ?? []) {
    if (n.status !== "sent") continue;
    if (!latestSentByOrder.has(n.order_id)) {
      latestSentByOrder.set(n.order_id, {
        id: n.id,
        created_at: n.created_at,
        channel: n.channel ?? "email",
      });
    }
  }

  // Orders that have already responded (skip them)
  const { data: responded } = await supabase
    .from("job_notifications")
    .select("order_id")
    .eq("tenant_id", ctx.tenant.id)
    .eq("type", "customer_approval")
    .eq("status", "responded")
    .in("order_id", orderIds);

  const respondedOrderIds = new Set((responded ?? []).map((r) => r.order_id));

  const cutoffMs = staleDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const eligible: BatchRerequestOrder[] = [];

  for (const order of orders) {
    if (respondedOrderIds.has(order.id)) continue; // already approved/rejected

    const customer = (order.customer as { name?: string | null; email?: string | null; phone?: string | null } | null) ?? null;
    const sent = latestSentByOrder.get(order.id);

    if (!sent) {
      // Never had an approval notification sent
      eligible.push({
        orderId: order.id,
        title: String(order.title ?? order.id),
        customerName: customer?.name ?? null,
        customerEmail: customer?.email ?? null,
        customerPhone: customer?.phone ?? null,
        reason: "never_sent",
        lastSentAt: null,
        notificationId: null,
        channel: null,
      });
    } else {
      const ageMs = now - new Date(sent.created_at).getTime();
      if (ageMs >= cutoffMs) {
        eligible.push({
          orderId: order.id,
          title: String(order.title ?? order.id),
          customerName: customer?.name ?? null,
          customerEmail: customer?.email ?? null,
          customerPhone: customer?.phone ?? null,
          reason: "stale",
          lastSentAt: sent.created_at,
          notificationId: sent.id,
          channel: sent.channel,
        });
      }
    }
  }

  return NextResponse.json({ eligible });
}

/**
 * POST /api/notifications/batch-rerequest
 *
 * Body: { columnId: string, staleDays: number }
 *
 * Sends approval requests to all eligible orders:
 * - "stale" orders: re-dispatch existing notification (refresh token TTL).
 * - "never_sent" orders: create + dispatch a new notification if the order
 *   has customer contact info (email or phone).
 */
export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    columnId?: string;
    staleDays?: number;
  };

  if (!body.columnId) {
    return NextResponse.json({ error: "columnId is required" }, { status: 400 });
  }
  const staleDays = Math.max(1, body.staleDays ?? 2);

  // Re-use the GET logic to get the eligible list
  const listUrl = new URL(
    `/api/notifications/batch-rerequest?columnId=${body.columnId}&staleDays=${staleDays}`,
    "http://localhost"
  );
  const supabase = await createClient();

  // Fetch orders in column with customer info
  const { data: orders } = await supabase
    .from("orders")
    .select("*, customer:customers(name, email, phone, preferred_channel)")
    .eq("tenant_id", ctx.tenant.id)
    .eq("column_id", body.columnId)
    .is("removed_at", null);

  if (!orders || orders.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, results: [] });
  }

  const orderIds = orders.map((o) => o.id);

  const { data: notifications } = await supabase
    .from("job_notifications")
    .select("*, order:orders(*)")
    .eq("tenant_id", ctx.tenant.id)
    .eq("type", "customer_approval")
    .in("order_id", orderIds)
    .in("status", ["sent", "pending"])
    .order("created_at", { ascending: false });

  const latestSentByOrder = new Map<string, JobNotification & { order: Order }>();
  for (const n of (notifications ?? []) as (JobNotification & { order: Order })[]) {
    if (n.status !== "sent") continue;
    if (!latestSentByOrder.has(n.order_id)) {
      latestSentByOrder.set(n.order_id, n);
    }
  }

  const { data: responded } = await supabase
    .from("job_notifications")
    .select("order_id")
    .eq("tenant_id", ctx.tenant.id)
    .eq("type", "customer_approval")
    .eq("status", "responded")
    .in("order_id", orderIds);
  const respondedOrderIds = new Set((responded ?? []).map((r) => r.order_id));

  const cutoffMs = staleDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const results: {
    orderId: string;
    title: string;
    reason: "stale" | "never_sent";
    ok: boolean;
    skipped?: boolean;
    error?: string;
  }[] = [];

  for (const order of orders) {
    if (respondedOrderIds.has(order.id)) continue;

    const customer = order.customer as {
      name?: string | null;
      email?: string | null;
      phone?: string | null;
      preferred_channel?: string | null;
    } | null;

    const title = String((order as { title?: unknown }).title ?? order.id);
    const sent = latestSentByOrder.get(order.id);

    if (sent) {
      const ageMs = now - new Date(sent.created_at).getTime();
      if (ageMs < cutoffMs) continue; // not stale yet

      // Re-dispatch: refresh token TTL and resend
      try {
        const expiresAt = new Date(Date.now() + NOTIFICATION_TOKEN_TTL_MS).toISOString();
        await supabase
          .from("job_notifications")
          .update({ token_expires_at: expiresAt })
          .eq("id", sent.id)
          .eq("tenant_id", ctx.tenant.id);

        const validChannels = ["email", "sms", "both"] as const;
        const channel = (validChannels as readonly string[]).includes(sent.channel ?? "")
          ? (sent.channel as "email" | "sms" | "both")
          : "email";

        await dispatchNotification(supabase, {
          notification: sent,
          order: sent.order ?? (order as Order),
          tenantName: ctx.tenant.name,
          channel,
          toEmail: null,
          toPhone: null,
          actorUserId: ctx.userId,
        });
        results.push({ orderId: order.id, title, reason: "stale", ok: true });
      } catch (err) {
        results.push({ orderId: order.id, title, reason: "stale", ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    } else {
      // Never sent — create a new notification if there's a contact
      const toEmail = customer?.email ?? null;
      const toPhone = customer?.phone ?? null;
      if (!toEmail && !toPhone) {
        results.push({ orderId: order.id, title, reason: "never_sent", ok: false, skipped: true, error: "No customer contact" });
        continue;
      }

      try {
        // Determine channel
        const preferred = customer?.preferred_channel;
        const channel: "email" | "sms" | "both" =
          toEmail && toPhone ? (preferred === "sms" ? "both" : "both")
          : toEmail ? "email"
          : "sms";

        // Insert new notification
        const expiresAt = new Date(Date.now() + NOTIFICATION_TOKEN_TTL_MS).toISOString();
        const { data: newNotif, error: insertErr } = await supabase
          .from("job_notifications")
          .insert({
            tenant_id: ctx.tenant.id,
            order_id: order.id,
            type: "customer_approval",
            channel,
            token_expires_at: expiresAt,
            status: "pending",
            created_by: ctx.userId,
          })
          .select("*")
          .single();

        if (insertErr || !newNotif) throw new Error(insertErr?.message ?? "Insert failed");

        // Expire old pending notifications for this order
        await supabase
          .from("job_notifications")
          .update({ status: "expired" })
          .eq("tenant_id", ctx.tenant.id)
          .eq("order_id", order.id)
          .eq("type", "customer_approval")
          .neq("id", newNotif.id)
          .in("status", ["pending", "sent"]);

        await dispatchNotification(supabase, {
          notification: newNotif as JobNotification,
          order: order as Order,
          tenantName: ctx.tenant.name,
          channel,
          toEmail,
          toPhone,
          actorUserId: ctx.userId,
        });

        results.push({ orderId: order.id, title, reason: "never_sent", ok: true });
      } catch (err) {
        results.push({ orderId: order.id, title, reason: "never_sent", ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  const sent = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;

  return NextResponse.json({ ok: true, sent, failed, skipped, results });
}
