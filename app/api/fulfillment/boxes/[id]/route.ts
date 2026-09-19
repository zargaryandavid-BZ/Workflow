import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { orderCardThumbnails } from "@/lib/board-order-enrichment";
import { firstThumbnailUrl } from "@/lib/card-image";
import { createClient } from "@/lib/supabase/server";
import { compactOpenFulfillmentBoxes } from "@/lib/fulfillment-compact-boxes";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { box_number?: string };
  if (!body.box_number?.trim()) {
    return NextResponse.json({ error: "box_number required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fulfillment_boxes")
    .update({ box_number: body.box_number.trim() })
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "open") // only open boxes can be renamed
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "Box not found or already sent" }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const { id } = await params;
  const supabase = await createClient();
  await supabase
    .from("fulfillment_box_orders")
    .delete()
    .eq("box_id", id)
    .eq("tenant_id", ctx.tenant.id);

  const { data, error } = await supabase
    .from("fulfillment_boxes")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "open")
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data?.length) {
    return NextResponse.json(
      { error: "Box not found or already sent" },
      { status: 404 }
    );
  }
  await compactOpenFulfillmentBoxes(supabase, ctx.tenant.id);
  return NextResponse.json({ ok: true });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const { id } = await params;
  const supabase = await createClient();

  // Get box
  const { data: box, error: boxError } = await supabase
    .from("fulfillment_boxes")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .single();

  if (boxError || !box) {
    return NextResponse.json({ error: "Box not found" }, { status: 404 });
  }

  // Get orders in box
  const { data: boxOrders, error: ordersError } = await supabase
    .from("fulfillment_box_orders")
    .select(`
      id,
      quantity_expected,
      quantity_received,
      receive_status,
      orders (
        id,
        title,
        specs,
        column_id,
        customer_id
      )
    `)
    .eq("box_id", id)
    .eq("tenant_id", ctx.tenant.id);

  if (ordersError) {
    return NextResponse.json({ error: ordersError.message }, { status: 500 });
  }

  const orders = (boxOrders ?? []).map((bo) => {
    const joined = Array.isArray(bo.orders) ? bo.orders[0] : bo.orders;
    const order =
      joined && typeof joined === "object"
        ? (joined as {
            id?: unknown;
            title?: unknown;
            specs?: unknown;
            column_id?: unknown;
            customer_id?: unknown;
          })
        : null;
    return {
      box_order_id: bo.id,
      quantity_expected: bo.quantity_expected,
      quantity_received: bo.quantity_received,
      receive_status:
        "receive_status" in bo
          ? ((bo as { receive_status?: string | null }).receive_status ?? null)
          : null,
      id: order?.id,
      title: order?.title,
      specs: order?.specs,
      column_id: order?.column_id,
      customer_id: order?.customer_id,
    };
  });

  const forThumbs = orders.filter(
    (o): o is typeof o & { id: string } => typeof o.id === "string"
  );
  const thumbs = await orderCardThumbnails(supabase, forThumbs);

  return NextResponse.json({
    ...box,
    orders: orders.map((o) => ({
      ...o,
      thumbnail_url:
        typeof o.id === "string"
          ? (firstThumbnailUrl(thumbs[o.id]) ?? null)
          : null,
    })),
  });
}
