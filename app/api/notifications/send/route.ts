import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";
import type {
  NotificationChannel,
  NotificationType,
  Order,
} from "@/lib/types";

const TYPES: NotificationType[] = ["missing_info", "customer_approval", "ready_to_ship"];
const CHANNELS: NotificationChannel[] = ["email", "sms", "manual", "none"];

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    orderId?: string;
    type?: NotificationType;
    channel?: NotificationChannel;
    staffNote?: string;
    toEmail?: string;
    toPhone?: string;
    subject?: string;
    messageBody?: string;
  };

  if (
    !body.orderId ||
    !body.type ||
    !body.channel ||
    !TYPES.includes(body.type) ||
    !CHANNELS.includes(body.channel)
  ) {
    return NextResponse.json(
      { error: "orderId, a valid type and channel are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", body.orderId)
    .maybeSingle();
  if (!order || (order as Order).tenant_id !== ctx.tenant.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  try {
    const { notification, actionUrl } = await createNotification(supabase, {
      order: order as Order,
      tenantName: ctx.tenant.name,
      type: body.type,
      channel: body.channel,
      staffNote: body.staffNote ?? null,
      toEmail: body.toEmail ?? null,
      toPhone: body.toPhone ?? null,
      createdBy: ctx.userId,
      subject: body.subject ?? null,
      messageBody: body.messageBody ?? null,
    });
    return NextResponse.json({
      ok: true,
      channel: body.channel,
      token: notification.token,
      actionUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to notify";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
