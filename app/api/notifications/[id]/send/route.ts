import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { dispatchNotification } from "@/lib/notifications";
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
    channel?: "email" | "sms";
    toEmail?: string;
    toPhone?: string;
  };
  if (body.channel !== "email" && body.channel !== "sms") {
    return NextResponse.json(
      { error: "channel must be email or sms" },
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

  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", notification.order_id)
    .maybeSingle();
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  try {
    const result = await dispatchNotification(supabase, {
      notification: notification as JobNotification,
      order: order as Order,
      tenantName: ctx.tenant.name,
      channel: body.channel,
      toEmail: body.toEmail ?? null,
      toPhone: body.toPhone ?? null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
