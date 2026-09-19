import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; orderId: string }> }
) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const { id: boxId, orderId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    quantity_expected?: unknown;
  };
  const qty = Math.floor(Number(body.quantity_expected));
  if (!Number.isFinite(qty) || qty < 1) {
    return NextResponse.json(
      { error: "quantity_expected must be a positive integer" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

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
    return NextResponse.json(
      { error: "Cannot modify a sent or received box" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("fulfillment_box_orders")
    .update({ quantity_expected: qty })
    .eq("box_id", boxId)
    .eq("order_id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Order not in this box" },
      { status: 404 }
    );
  }

  return NextResponse.json(data);
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

  // Verify box belongs to tenant
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
    return NextResponse.json({ error: "Cannot modify a sent or received box" }, { status: 400 });
  }

  const { error } = await supabase
    .from("fulfillment_box_orders")
    .delete()
    .eq("box_id", boxId)
    .eq("order_id", orderId)
    .eq("tenant_id", ctx.tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return new NextResponse(null, { status: 204 });
}
