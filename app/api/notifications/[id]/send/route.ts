import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  NOTIFICATION_TOKEN_TTL_MS,
  createNotification,
  dispatchNotification,
} from "@/lib/notifications";
import type { JobNotification, Order } from "@/lib/types";

export const maxDuration = 180;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    channel?: "email" | "sms" | "both";
    toEmail?: string;
    toPhone?: string;
  };
  if (
    body.channel !== "email" &&
    body.channel !== "sms" &&
    body.channel !== "both"
  ) {
    return NextResponse.json(
      { error: "channel must be email, sms, or both" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  // Single join query — fetches notification + order in one round trip.
  const { data: notificationRow } = await supabase
    .from("job_notifications")
    .select("*, order:orders(*)")
    .eq("id", id)
    .maybeSingle();
  if (!notificationRow || notificationRow.tenant_id !== ctx.tenant.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const order = (notificationRow as Record<string, unknown>).order as Order | null;
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Strip the joined relation so typed matches JobNotification shape.
  const { order: _o, ...notificationData } = notificationRow as typeof notificationRow & { order: unknown };
  const typed = notificationData as unknown as JobNotification;

  if (typed.status === "expired") {
    return NextResponse.json(
      {
        error:
          "This notification was replaced by a newer send. Refresh and try again.",
      },
      { status: 400 }
    );
  }

  try {
    // Reminder while still waiting: reuse the same token so the previous
    // SMS/email link keeps working. A new token is only for a new round
    // after the customer already answered.
    if (typed.status === "sent") {
      const expiresAt = new Date(
        Date.now() + NOTIFICATION_TOKEN_TTL_MS
      ).toISOString();
      await supabase
        .from("job_notifications")
        .update({ token_expires_at: expiresAt })
        .eq("id", typed.id)
        .eq("tenant_id", ctx.tenant.id);

      const result = await dispatchNotification(supabase, {
        notification: typed,
        order: order as Order,
        tenantName: ctx.tenant.name,
        channel: body.channel,
        toEmail: body.toEmail ?? null,
        toPhone: body.toPhone ?? null,
        actorUserId: ctx.userId,
      });
      return NextResponse.json({
        ok: true,
        resent: true,
        reused: true,
        notificationId: typed.id,
        ...result,
      });
    }

    if (typed.status === "responded") {
      const { notification: neu, actionUrl, warning } = await createNotification(
        supabase,
        {
          order: order as Order,
          tenantName: ctx.tenant.name,
          type: typed.type,
          channel: body.channel,
          staffNote: typed.staff_note,
          toEmail: body.toEmail ?? null,
          toPhone: body.toPhone ?? null,
          createdBy: ctx.userId,
        }
      );

      return NextResponse.json({
        ok: true,
        resent: true,
        notificationId: neu.id,
        actionUrl,
        warning,
      });
    }

    // First send (pending) — update the existing row.
    const result = await dispatchNotification(supabase, {
      notification: typed,
      order: order as Order,
      tenantName: ctx.tenant.name,
      channel: body.channel,
      toEmail: body.toEmail ?? null,
      toPhone: body.toPhone ?? null,
      actorUserId: ctx.userId,
    });
    return NextResponse.json({ ok: true, resent: false, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
