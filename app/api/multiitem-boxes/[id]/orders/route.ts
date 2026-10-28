import { NextResponse } from "next/server";
import { resolveMultiitemAccess } from "@/lib/multiitem-box-access";
import {
  clampBoxLineToTicket,
  findTenantOrderByScan,
  isAutoSplitSkuLines,
  multiitemBoxSkuLinesFromOrderSpecs,
  normalizeMultiitemBoxSkuLines,
  overPackedSkuError,
  packedBoxQuantityForOrder,
  packedSkuQuantitiesForOrder,
  remainingSkuLines,
  resolveBoxLineDetails,
} from "@/lib/multiitem-box-lookup";
import { boxOrderThumbnailUrls } from "@/lib/multiitem-box-artwork";

const BOX_ORDER_SELECT = "*";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await resolveMultiitemAccess();
  if ("error" in access) return access.error;
  const { supabase, tenantId } = access;
  const { id: boxId } = await params;

  const body = (await request.json().catch(() => ({}))) as {
    order_id?: string;
    query?: string;
    sku_lines?: unknown;
  };
  const skuLines = normalizeMultiitemBoxSkuLines(body.sku_lines);
  if (Object.prototype.hasOwnProperty.call(body, "sku_lines") && skuLines.length === 0) {
    return NextResponse.json(
      { error: "Select at least one SKU" },
      { status: 400 }
    );
  }

  const { data: box, error: boxError } = await supabase
    .from("multiitem_boxes")
    .select("id, status, customer_id")
    .eq("id", boxId)
    .eq("tenant_id", tenantId)
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
        tenantId,
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
        .eq("tenant_id", tenantId)
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
      .eq("tenant_id", tenantId)
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

  const { quantity: ticketQty, itemTitle } = await resolveBoxLineDetails(
    supabase,
    tenantId,
    orderId,
    specs
  );
  const ticketLines = multiitemBoxSkuLinesFromOrderSpecs(
    specs,
    ticketQty,
    null
  );
  // A SKU can be split across boxes: default to what other boxes left over.
  let packedByPage: Map<number, number>;
  try {
    packedByPage = await packedSkuQuantitiesForOrder(
      supabase,
      tenantId,
      orderId,
      boxId
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
  const ticketLeft = remainingSkuLines(ticketLines, packedByPage).filter(
    (line) => line.quantity > 0
  );
  const overPacked = overPackedSkuError(skuLines, ticketLines, packedByPage);
  if (overPacked) {
    return NextResponse.json({ error: overPacked }, { status: 409 });
  }
  const selectedPages = new Set(skuLines.map((line) => line.page));
  const linesFromTicket =
    skuLines.length === 0
      ? ticketLeft
      : isAutoSplitSkuLines(skuLines, ticketQty)
        ? ticketLeft.filter((line) => selectedPages.has(line.page))
        : skuLines;
  const skuLinesToStore =
    linesFromTicket.length > 0 ? linesFromTicket : skuLines;
  let packedElsewhere = 0;
  try {
    packedElsewhere = await packedBoxQuantityForOrder(
      supabase,
      tenantId,
      orderId,
      boxId
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
  const clamped = clampBoxLineToTicket({
    requested:
      skuLinesToStore.length > 0
        ? skuLinesToStore.reduce((sum, line) => sum + line.quantity, 0)
        : undefined,
    ticketQty,
    packedElsewhere,
  });
  if ("error" in clamped) {
    return NextResponse.json({ error: clamped.error }, { status: 409 });
  }
  const quantity = clamped.quantity;

  const { data: existing } = await supabase
    .from("multiitem_box_orders")
    .select(BOX_ORDER_SELECT)
    .eq("box_id", boxId)
    .eq("order_id", orderId)
    .maybeSingle();

  if (existing) {
    const thumbs = await boxOrderThumbnailUrls(supabase, [orderId]);
    return NextResponse.json({
      order: {
        ...existing,
        thumbnail_url: thumbs.get(orderId) ?? null,
      },
      already: true,
    });
  }

  const insertPayload = {
    tenant_id: tenantId,
    box_id: boxId,
    order_id: orderId,
    order_title: orderTitle,
    item_title: itemTitle || null,
    customer_name: customerName || null,
    quantity,
    sku_lines: skuLinesToStore,
  };
  let { data: inserted, error: insertError } = await supabase
    .from("multiitem_box_orders")
    .insert(insertPayload)
    .select(BOX_ORDER_SELECT)
    .single();

  // Keep older databases usable until the accompanying sku_lines migration is
  // applied; the UI still shows this scan's lines for the current session.
  if (
    insertError?.message.includes("sku_lines") &&
    insertError.message.includes("column")
  ) {
    const legacy = await supabase
      .from("multiitem_box_orders")
      .insert({
        tenant_id: tenantId,
        box_id: boxId,
        order_id: orderId,
        order_title: orderTitle,
        item_title: itemTitle || null,
        customer_name: customerName || null,
        quantity,
      })
      .select(BOX_ORDER_SELECT)
      .single();
    inserted = legacy.data
      ? { ...legacy.data, sku_lines: skuLinesToStore }
      : legacy.data;
    insertError = legacy.error;
  }

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
      .eq("tenant_id", tenantId);
  }

  const thumbs = await boxOrderThumbnailUrls(supabase, [orderId]);

  return NextResponse.json(
    {
      order: {
        ...inserted,
        customer_email: customerEmail || null,
        customer_phone: customerPhone || null,
        thumbnail_url: thumbs.get(orderId) ?? null,
      },
      ticket_qty: clamped.ticketQty,
      packed_elsewhere: packedElsewhere,
    },
    { status: 201 }
  );
}
