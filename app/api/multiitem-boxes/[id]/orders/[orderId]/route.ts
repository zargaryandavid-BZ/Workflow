import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { createClient } from "@/lib/supabase/server";
import {
  clampBoxLineToTicket,
  packedBoxQuantityForOrder,
  resolveBoxLineQuantity,
} from "@/lib/multiitem-box-lookup";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; orderId: string }> }
) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id: boxId, orderId } = await params;

  const body = (await request.json().catch(() => ({}))) as {
    quantity?: number;
  };
  const requested = Math.floor(Number(body.quantity));
  if (!Number.isFinite(requested) || requested < 1) {
    return NextResponse.json({ error: "quantity must be at least 1" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: orderRow } = await supabase
    .from("orders")
    .select("specs")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  const ticketQty = await resolveBoxLineQuantity(
    supabase,
    ctx.tenant.id,
    orderId,
    (orderRow?.specs ?? null) as Record<string, unknown> | null
  );
  let packedElsewhere = 0;
  try {
    packedElsewhere = await packedBoxQuantityForOrder(
      supabase,
      ctx.tenant.id,
      orderId,
      boxId
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
  const clamped = clampBoxLineToTicket({
    requested,
    ticketQty,
    packedElsewhere,
  });
  if ("error" in clamped) {
    return NextResponse.json({ error: clamped.error }, { status: 409 });
  }
  const quantity = clamped.quantity;

  const { data, error } = await supabase
    .from("multiitem_box_orders")
    .update({ quantity })
    .eq("box_id", boxId)
    .eq("order_id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .select("id, box_id, order_id, order_title, item_title, customer_name, quantity, added_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  return NextResponse.json({ order: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; orderId: string }> }
) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id: boxId, orderId } = await params;

  const supabase = await createClient();
  const { error } = await supabase
    .from("multiitem_box_orders")
    .delete()
    .eq("box_id", boxId)
    .eq("order_id", orderId)
    .eq("tenant_id", ctx.tenant.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
