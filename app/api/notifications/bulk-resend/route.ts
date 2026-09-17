import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { dispatchNotification, NOTIFICATION_TOKEN_TTL_MS } from "@/lib/notifications";
import type { JobNotification, Order } from "@/lib/types";

export const maxDuration = 300;

/**
 * POST /api/notifications/bulk-resend
 * Resends all "sent" (awaiting customer response) approval notifications for
 * the tenant. Each notification gets its token TTL refreshed and the original
 * channel (email/sms/both) reused so existing links stay valid.
 *
 * Returns per-notification success/failure so the caller can show a summary.
 */
export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    /** Optional: only resend this specific notification id */
    notificationId?: string;
    /** Override channel for all resends (default: use original channel) */
    channel?: "email" | "sms" | "both";
    /** Dry-run: return the list without actually sending */
    dryRun?: boolean;
  };

  const supabase = await createClient();

  // Fetch all sent approval notifications for this tenant (+ their orders)
  let query = supabase
    .from("job_notifications")
    .select("*, order:orders(*)")
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "sent")
    .eq("type", "customer_approval")
    .order("created_at", { ascending: false });

  if (body.notificationId) {
    query = query.eq("id", body.notificationId);
  }

  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, results: [], message: "No pending approvals found" });
  }

  if (body.dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      count: rows.length,
      notifications: rows.map((r) => ({
        id: r.id,
        orderId: r.order_id,
        orderTitle: (r.order as Order | null)?.title ?? r.order_id,
        channel: r.channel,
        createdAt: r.created_at,
      })),
    });
  }

  const results: {
    notificationId: string;
    orderId: string;
    orderTitle: string;
    ok: boolean;
    error?: string;
  }[] = [];

  for (const row of rows) {
    const order = (row as Record<string, unknown>).order as Order | null;
    if (!order) {
      results.push({ notificationId: row.id, orderId: row.order_id, orderTitle: row.order_id, ok: false, error: "Order not found" });
      continue;
    }

    const { order: _o, ...notificationData } = row as typeof row & { order: unknown };
    const notification = notificationData as unknown as JobNotification;

    const channel = (body.channel as JobNotification["channel"]) ?? notification.channel;
    const validChannels = ["email", "sms", "both"] as const;
    const useChannel = (validChannels as readonly string[]).includes(channel as string)
      ? (channel as "email" | "sms" | "both")
      : "email";

    try {
      // Refresh token TTL so existing link keeps working
      const expiresAt = new Date(Date.now() + NOTIFICATION_TOKEN_TTL_MS).toISOString();
      await supabase
        .from("job_notifications")
        .update({ token_expires_at: expiresAt })
        .eq("id", notification.id)
        .eq("tenant_id", ctx.tenant.id);

      await dispatchNotification(supabase, {
        notification,
        order,
        tenantName: ctx.tenant.name,
        channel: useChannel,
        toEmail: null,
        toPhone: null,
        actorUserId: ctx.userId,
      });

      results.push({
        notificationId: notification.id,
        orderId: order.id,
        orderTitle: String(order.title ?? order.id),
        ok: true,
      });
    } catch (err) {
      results.push({
        notificationId: notification.id,
        orderId: order.id,
        orderTitle: String(order.title ?? order.id),
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return NextResponse.json({ ok: true, sent: succeeded, failed, results });
}
