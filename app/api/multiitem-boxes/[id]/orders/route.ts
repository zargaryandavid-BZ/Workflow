import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import {
  findTenantOrderByScan,
  resolveBoxLineDetails,
} from "@/lib/multiitem-box-lookup";
import { createClient } from "@/lib/supabase/server";

const BOX_ORDER_SELECT =
  "id, box_id, order_id, order_title, item_title, customer_name, quantity, added_at";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id: boxId } = await params;

  const body = (await request.json().catch(() => ({}))) as {
    order_id?: string;
    query?: string;
  };

  const supabase = await createClient();
  const { data: box, error: boxError } = await supabase
    .from("multiitem_boxes")
    .select("id, status, customer_id")
    .eq("id", boxId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (boxError || !box) {
    return NextResponse.json({ error: "Box not found" }, { status: 404 });
  }
  if (box.status !== "open") {
    return NextResponse.json({ error: "Box is already saved" }, { status: 400 });
  }

  let orderId = body.order_id?.trim() ?? "";
  let orderTitle = "";
  let customerId = "";
  let customerName = "";
  let customerEmail = "";
  let customerPhone = "";
  let specs: Record<string, unknown> | null = null;

  if (!orderId && body.query?.trim()) {
    try {
      const found = await findTenantOrderByScan(
        supabase,
        ctx.tenant.id,
        body.query
      );
      if (!found) {
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      }
      orderId = found.id;
      orderTitle = found.title;
      customerName = found.customerName;
      specs = found.specs;

      const { data: contactOrder } = await supabase
        .from("orders")
        .select("customer:customers(id, email, phone)")
        .eq("id", orderId)
        .eq("tenant_id", ctx.tenant.id)
        .maybeSingle();
      const contactRaw = contactOrder?.customer as
        | { id: string; email: string | null; phone: string | null }
        | { id: string; email: string | null; phone: string | null }[]
        | null
        | undefined;
      const contact = Array.isArray(contactRaw) ? contactRaw[0] : contactRaw;
      customerId = contact?.id ?? "";
      customerEmail = contact?.email?.trim() || "";
      customerPhone = contact?.phone?.trim() || "";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lookup failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } else if (orderId) {
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, title, specs, customer:customers(id, name, email, phone)")
      .eq("id", orderId)
      .eq("tenant_id", ctx.tenant.id)
      .is("removed_at", null)
      .maybeSingle();
    if (orderError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    orderTitle = order.title;
    specs = (order.specs ?? null) as Record<string, unknown> | null;
    const cust = order.customer as
      | {
          id: string;
          name: string | null;
          email: string | null;
          phone: string | null;
        }
      | {
          id: string;
          name: string | null;
          email: string | null;
          phone: string | null;
        }[]
      | null;
    const row = Array.isArray(cust) ? cust[0] : cust;
    customerId = row?.id ?? "";
    customerName = row?.name?.trim() || "";
    customerEmail = row?.email?.trim() || "";
    customerPhone = row?.phone?.trim() || "";
  } else {
    return NextResponse.json(
      { error: "order_id or query is required" },
      { status: 400 }
    );
  }

  const { quantity, itemTitle } = await resolveBoxLineDetails(
    supabase,
    ctx.tenant.id,
    orderId,
    specs
  );

  const { data: existing } = await supabase
    .from("multiitem_box_orders")
    .select(BOX_ORDER_SELECT)
    .eq("box_id", boxId)
    .eq("order_id", orderId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ order: existing, already: true });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("multiitem_box_orders")
    .insert({
      tenant_id: ctx.tenant.id,
      box_id: boxId,
      order_id: orderId,
      order_title: orderTitle,
      item_title: itemTitle || null,
      customer_name: customerName || null,
      quantity,
    })
    .select(BOX_ORDER_SELECT)
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  if (!box.customer_id && customerId) {
    await supabase
      .from("multiitem_boxes")
      .update({
        customer_id: customerId,
        customer_name: customerName || null,
        customer_email: customerEmail || null,
        customer_phone: customerPhone || null,
      })
      .eq("id", boxId)
      .eq("tenant_id", ctx.tenant.id);
  }

  return NextResponse.json(
    {
      order: {
        ...inserted,
        customer_email: customerEmail || null,
        customer_phone: customerPhone || null,
      },
    },
    { status: 201 }
  );
}
