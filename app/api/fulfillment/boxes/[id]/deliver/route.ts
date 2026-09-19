import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/automation";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const { id: boxId } = await params;
  const supabase = await createClient();

  // Verify box
  const { data: box, error: boxError } = await supabase
    .from("fulfillment_boxes")
    .select("id, status")
    .eq("id", boxId)
    .eq("tenant_id", ctx.tenant.id)
    .single();

  if (boxError || !box) {
    return NextResponse.json({ error: "Box not found" }, { status: 404 });
  }
  if (box.status !== "open") {
    return NextResponse.json({ error: "Box is already sent or received" }, { status: 400 });
  }

  // Get send column setting (optional — still mark the box sent without it)
  const { data: settings } = await supabase
    .from("fulfillment_settings")
    .select("send_column_id")
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  // Get all order IDs in the box
  const { data: boxOrders, error: boError } = await supabase
    .from("fulfillment_box_orders")
    .select("order_id")
    .eq("box_id", boxId)
    .eq("tenant_id", ctx.tenant.id);

  if (boError) return NextResponse.json({ error: boError.message }, { status: 500 });

  const orderIds = (boxOrders ?? []).map((bo) => bo.order_id);

  if (settings?.send_column_id) {
    const { error: updateError } = await supabase
      .from("orders")
      .update({ column_id: settings.send_column_id })
      .in("id", orderIds)
      .eq("tenant_id", ctx.tenant.id);

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Update box status
  const { error: boxUpdateError } = await supabase
    .from("fulfillment_boxes")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      sent_by: ctx.userId,
    })
    .eq("id", boxId)
    .eq("tenant_id", ctx.tenant.id);

  if (boxUpdateError) return NextResponse.json({ error: boxUpdateError.message }, { status: 500 });

  // Log activity for each order
  for (const orderId of orderIds) {
    try {
      await logActivity(supabase, {
        tenantId: ctx.tenant.id,
        orderId,
        actor: ctx.userId,
        action: "fulfillment:delivered",
        metadata: { box_id: boxId },
      });
    } catch {
      // Non-fatal — continue without activity log
    }
  }

  return NextResponse.json({ ok: true });
}
