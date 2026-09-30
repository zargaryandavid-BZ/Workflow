import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as {
    po_number?: string | null;
    size_label?: string | null;
    weight_lbs?: number | string | null;
    box_name?: string | null;
    status?: "open" | "saved";
    customer_order_id?: string;
  };

  const supabase = await createClient();
  const patch: Record<string, unknown> = {};

  if (body.po_number !== undefined) {
    patch.po_number = body.po_number?.trim() || null;
  }
  if (body.size_label !== undefined) {
    patch.size_label = body.size_label?.trim() || null;
  }
  if (body.weight_lbs !== undefined) {
    if (body.weight_lbs == null || body.weight_lbs === "") {
      patch.weight_lbs = null;
    } else {
      const n = Number(body.weight_lbs);
      patch.weight_lbs = Number.isFinite(n) ? n : null;
    }
  }
  if (body.box_name !== undefined) {
    const name = body.box_name?.trim() ?? "";
    if (name) patch.box_name = name;
  }
  if (body.status === "saved") {
    patch.status = "saved";
    patch.saved_at = new Date().toISOString();
  }
  if (body.customer_order_id !== undefined) {
    const orderId = body.customer_order_id.trim();
    if (!orderId) {
      return NextResponse.json(
        { error: "Customer order is required" },
        { status: 400 }
      );
    }
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("customer:customers(id, name, email, phone)")
      .eq("id", orderId)
      .eq("tenant_id", ctx.tenant.id)
      .is("removed_at", null)
      .maybeSingle();
    if (orderError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    const raw = order.customer as
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
    const customer = Array.isArray(raw) ? raw[0] : raw;
    if (!customer?.id) {
      return NextResponse.json(
        { error: "This order has no customer information" },
        { status: 400 }
      );
    }
    patch.customer_id = customer.id;
    patch.customer_name = customer.name?.trim() || null;
    patch.customer_email = customer.email?.trim() || null;
    patch.customer_phone = customer.phone?.trim() || null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("multiitem_boxes")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .select(
      "id, box_name, box_number, box_date, po_number, size_label, weight_lbs, customer_id, customer_name, customer_email, customer_phone, status, created_at, saved_at"
    )
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Box not found" }, { status: 404 });
  }

  return NextResponse.json({ box: data });
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

  const { data, error } = await supabase
    .from("multiitem_boxes")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Box not found" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
