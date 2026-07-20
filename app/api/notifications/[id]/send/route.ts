import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  createNotification,
  dispatchNotification,
} from "@/lib/notifications";
import type { JobNotification, Order } from "@/lib/types";

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
  const { data: notification } = await supabase
    .from("job_notifications")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!notification || notification.tenant_id !== ctx.tenant.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const typed = notification as JobNotification;
  if (typed.status === "responded") {
    return NextResponse.json(
      { error: "This notification was already answered by the customer." },
      { status: 400 }
    );
  }
  if (typed.status === "expired") {
    return NextResponse.json(
      { error: "This notification was replaced by a newer send. Refresh and try again." },
      { status: 400 }
    );
  }

  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", notification.order_id)
    .maybeSingle();
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  try {
    // Already sent once → create a new history row (resend) and retire the old link.
    if (typed.status === "sent") {
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

      await supabase
        .from("job_notifications")
        .update({
          status: "expired",
          token_expires_at: new Date().toISOString(),
        })
        .eq("id", typed.id)
        .eq("tenant_id", ctx.tenant.id);

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
    });
    return NextResponse.json({ ok: true, resent: false, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
