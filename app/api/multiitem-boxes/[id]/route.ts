import { NextResponse } from "next/server";
import { resolveMultiitemAccess } from "@/lib/multiitem-box-access";
import { logActivity } from "@/lib/automation";
import { multiitemBoxNameFromIsoDate, shopDayKey } from "@/lib/fulfillment-day";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await resolveMultiitemAccess();
  if ("error" in access) return access.error;
  const { supabase, tenantId } = access;
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as {
    po_number?: string | null;
    size_label?: string | null;
    weight_lbs?: number | string | null;
    status?: "open" | "saved";
    customer_order_id?: string;
    carrier?: string | null;
    tracking_number?: string | null;
    /** true = mark shipped now, false = not shipped. */
    shipped?: boolean;
  };

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
  if (body.status === "saved") {
    patch.status = "saved";
    // A box is dated the day it's FIRST saved (shop time), so its name matches
    // the day tab it's listed under even if it stayed open for days. Editing
    // and re-saving an old box keeps that first date (reopen keeps saved_at).
    const savedDay = shopDayKey();
    const { data: current } = await supabase
      .from("multiitem_boxes")
      .select("box_number, saved_at")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const firstSavedAt = (current as { saved_at?: string | null } | null)?.saved_at;
    if (!firstSavedAt) patch.saved_at = new Date().toISOString();
    if (current && !firstSavedAt) {
      patch.box_date = savedDay;
      patch.box_name = multiitemBoxNameFromIsoDate(
        Number((current as { box_number: number }).box_number),
        savedDay
      );
    }
  } else if (body.status === "open") {
    // saved_at stays: it's the box's first save day (see above).
    patch.status = "open";
  }
  if (body.carrier !== undefined) {
    patch.carrier = body.carrier?.trim().slice(0, 60) || null;
  }
  if (body.tracking_number !== undefined) {
    patch.tracking_number = body.tracking_number?.trim().slice(0, 120) || null;
  }
  if (body.shipped === true) patch.shipped_at = new Date().toISOString();
  if (body.shipped === false) patch.shipped_at = null;

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
      .eq("tenant_id", tenantId)
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
    .eq("tenant_id", tenantId)
    .select("*, multiitem_box_orders(order_id)")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        error: /carrier|tracking_number|shipped_at/i.test(error.message)
          ? "Run migration 20261110000000_multiitem_box_shipping.sql in Supabase, then try again."
          : error.message,
      },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Box not found" }, { status: 404 });
  }

  // Each order in the box gets a history line: packed (on save) / shipped.
  const row = data as {
    box_name: string;
    carrier?: string | null;
    tracking_number?: string | null;
    multiitem_box_orders?: { order_id: string }[] | null;
  };
  const orderIds = [...new Set((row.multiitem_box_orders ?? []).map((o) => o.order_id))];
  const action =
    body.status === "saved" ? "packed_in_box" : body.shipped === true ? "box_shipped" : null;
  if (action && orderIds.length) {
    await Promise.all(
      orderIds.map((orderId) =>
        logActivity(supabase, {
          tenantId,
          orderId,
          actor: access.userId,
          action,
          metadata: {
            boxId: id,
            boxName: row.box_name,
            carrier: row.carrier ?? null,
            trackingNumber: row.tracking_number ?? null,
          },
        }).catch((err) => console.error("[multiitem-box] history failed", err))
      )
    );
  }

  const { multiitem_box_orders: _orders, ...box } = data as Record<string, unknown>;
  void _orders;
  return NextResponse.json({ box });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await resolveMultiitemAccess();
  if ("error" in access) return access.error;
  const { supabase, tenantId } = access;
  const { id } = await params;

  const { data, error } = await supabase
    .from("multiitem_boxes")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId)
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
