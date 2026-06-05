import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { saveNotificationRequest } from "@/lib/notifications";
import type { NotificationType, Order } from "@/lib/types";

const TYPES: NotificationType[] = ["missing_info", "customer_approval"];

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    orderId?: string;
    type?: NotificationType;
    staffNote?: string;
    columnId?: string;
    toEmail?: string;
  };

  if (
    !body.orderId ||
    !body.type ||
    !body.staffNote?.trim() ||
    !body.columnId ||
    !TYPES.includes(body.type)
  ) {
    return NextResponse.json(
      { error: "orderId, type, columnId, and staffNote are required" },
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
    const { notification, emailSent } = await saveNotificationRequest(supabase, {
      order: order as Order,
      tenantName: ctx.tenant.name,
      type: body.type,
      staffNote: body.staffNote,
      columnId: body.columnId,
      toEmail: body.toEmail ?? null,
      createdBy: ctx.userId,
    });
    return NextResponse.json({
      ok: true,
      emailSent,
      notificationId: notification.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save note";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
