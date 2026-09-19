import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { fulfillmentExpectedQty } from "@/lib/fulfillment-expected-qty";
import {
  pickScannedOrder,
  sanitizeScanLookupToken,
} from "@/lib/fulfillment-scan-order";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const { id: boxId } = await params;
  const body = await request.json().catch(() => ({})) as { order_number?: string };

  if (!body.order_number?.trim()) {
    return NextResponse.json({ error: "order_number is required" }, { status: 400 });
  }

  const supabase = await createClient();

  // Verify box belongs to tenant and is open
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

  const orderNumber = body.order_number.trim();
  const lookupToken = sanitizeScanLookupToken(orderNumber);
  if (!lookupToken) {
    return NextResponse.json({ error: "order_number is required" }, { status: 400 });
  }

  const orderSelect = "id, title, specs, column_id, customer_id";

  const { data: exactOrders, error: exactError } = await supabase
    .from("orders")
    .select(orderSelect)
    .eq("tenant_id", ctx.tenant.id)
    .is("removed_at", null)
    .or(
      `title.eq.${lookupToken},specs->>webhook_order_number.eq.${lookupToken}`
    );

  if (exactError) {
    return NextResponse.json({ error: exactError.message }, { status: 500 });
  }

  let order = pickScannedOrder(exactOrders ?? [], orderNumber);

  if (!order) {
    const { data: fuzzyOrders, error: fuzzyError } = await supabase
      .from("orders")
      .select(orderSelect)
      .eq("tenant_id", ctx.tenant.id)
      .is("removed_at", null)
      .or(
        `title.ilike.%${lookupToken}%,specs->>webhook_order_number.ilike.%${lookupToken}%`
      )
      .limit(80);

    if (fuzzyError) {
      return NextResponse.json({ error: fuzzyError.message }, { status: 500 });
    }
    order = pickScannedOrder(fuzzyOrders ?? [], orderNumber);
  }

  if (!order) {
    return NextResponse.json(
      { error: `Order "${orderNumber}" not found` },
      { status: 404 }
    );
  }

  const quantityExpected = fulfillmentExpectedQty(order.specs);

  // Add order to box
  const { data: boxOrder, error: insertError } = await supabase
    .from("fulfillment_box_orders")
    .insert({
      box_id: boxId,
      order_id: order.id,
      tenant_id: ctx.tenant.id,
      quantity_expected: quantityExpected,
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json({ error: "Order already in this box" }, { status: 409 });
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json(
    { ...boxOrder, order },
    { status: 201 }
  );
}
