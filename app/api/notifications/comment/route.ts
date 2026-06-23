import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import type { Order } from "@/lib/types";

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    orderId?: string;
    staffNote?: string;
    columnId?: string;
  };

  if (!body.orderId || !body.staffNote?.trim() || !body.columnId) {
    return NextResponse.json(
      { error: "orderId, staffNote, and columnId are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, tenant_id")
    .eq("id", body.orderId)
    .maybeSingle();

  if (!order || (order as Order).tenant_id !== ctx.tenant.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("job_notifications")
    .insert({
      tenant_id: ctx.tenant.id,
      order_id: body.orderId,
      type: "missing_info",
      channel: "none",
      status: "pending",
      staff_note: body.staffNote.trim(),
      column_id: body.columnId,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, notificationId: data.id });
}
