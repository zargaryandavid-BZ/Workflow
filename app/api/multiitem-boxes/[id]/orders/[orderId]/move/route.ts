import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import {
  normalizeMultiitemBoxSkuLines,
  type MultiitemBoxSkuLine,
} from "@/lib/multiitem-box-lookup";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; orderId: string }> }
) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id: fromBoxId, orderId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    to_box_id?: string;
    sku_page?: number;
  };
  const toBoxId = body.to_box_id?.trim() ?? "";
  const skuPage =
    body.sku_page == null ? null : Math.floor(Number(body.sku_page));

  if (!toBoxId) {
    return NextResponse.json({ error: "to_box_id is required" }, { status: 400 });
  }
  if (toBoxId === fromBoxId) {
    return NextResponse.json(
      { error: "Item is already in that box" },
      { status: 400 }
    );
  }
  if (skuPage != null && (!Number.isFinite(skuPage) || skuPage < 1)) {
    return NextResponse.json({ error: "Invalid SKU" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: boxes, error: boxesError } = await supabase
    .from("multiitem_boxes")
    .select(
      "id, status, customer_id, customer_name, customer_email, customer_phone"
    )
    .eq("tenant_id", ctx.tenant.id)
    .in("id", [fromBoxId, toBoxId]);

  if (boxesError) {
    return NextResponse.json({ error: boxesError.message }, { status: 500 });
  }
  const sourceBox = boxes?.find((box) => box.id === fromBoxId);
  const targetBox = boxes?.find((box) => box.id === toBoxId);
  if (!sourceBox || !targetBox) {
    return NextResponse.json({ error: "Box not found" }, { status: 404 });
  }
  if (sourceBox.status !== "open" || targetBox.status !== "open") {
    return NextResponse.json(
      { error: "Items can only move between open boxes" },
      { status: 400 }
    );
  }

  const { data: sourceOrder, error: sourceError } = await supabase
    .from("multiitem_box_orders")
    .select("*")
    .eq("tenant_id", ctx.tenant.id)
    .eq("box_id", fromBoxId)
    .eq("order_id", orderId)
    .maybeSingle();
  if (sourceError) {
    return NextResponse.json({ error: sourceError.message }, { status: 500 });
  }
  if (!sourceOrder) {
    return NextResponse.json(
      { error: "Order is not in the source box" },
      { status: 404 }
    );
  }

  const { data: targetOrder, error: targetError } = await supabase
    .from("multiitem_box_orders")
    .select("*")
    .eq("tenant_id", ctx.tenant.id)
    .eq("box_id", toBoxId)
    .eq("order_id", orderId)
    .maybeSingle();
  if (targetError) {
    return NextResponse.json({ error: targetError.message }, { status: 500 });
  }

  if (skuPage == null) {
    if (targetOrder) {
      return NextResponse.json(
        { error: "Order is already in the target box; move individual SKUs" },
        { status: 409 }
      );
    }
    const { data: moved, error: moveError } = await supabase
      .from("multiitem_box_orders")
      .update({ box_id: toBoxId })
      .eq("id", sourceOrder.id)
      .eq("tenant_id", ctx.tenant.id)
      .select("*")
      .single();
    if (moveError || !moved) {
      return NextResponse.json(
        { error: moveError?.message ?? "Move failed" },
        { status: 500 }
      );
    }
    await copyCustomerToEmptyBox(supabase, ctx.tenant.id, sourceBox, targetBox);
    return NextResponse.json({ moved, whole_order: true });
  }

  const sourceLines = normalizeMultiitemBoxSkuLines(sourceOrder.sku_lines);
  const movedLine = sourceLines.find((line) => line.page === skuPage);
  if (!movedLine) {
    return NextResponse.json(
      { error: "SKU is not in the source box" },
      { status: 404 }
    );
  }
  const remainingLines = sourceLines.filter((line) => line.page !== skuPage);
  const targetLines = normalizeMultiitemBoxSkuLines(targetOrder?.sku_lines);
  if (targetLines.some((line) => line.page === skuPage)) {
    return NextResponse.json(
      { error: "SKU is already in the target box" },
      { status: 409 }
    );
  }
  const nextTargetLines = [...targetLines, movedLine].sort(
    (a, b) => a.page - b.page
  );
  const nextTargetQuantity = sumSkuQuantity(nextTargetLines);

  let insertedTargetId: string | null = null;
  if (targetOrder) {
    const { error } = await supabase
      .from("multiitem_box_orders")
      .update({
        sku_lines: nextTargetLines,
        quantity: nextTargetQuantity,
      })
      .eq("id", targetOrder.id)
      .eq("tenant_id", ctx.tenant.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    const { data: inserted, error } = await supabase
      .from("multiitem_box_orders")
      .insert({
        tenant_id: ctx.tenant.id,
        box_id: toBoxId,
        order_id: sourceOrder.order_id,
        order_title: sourceOrder.order_title,
        item_title: sourceOrder.item_title,
        customer_name: sourceOrder.customer_name,
        quantity: movedLine.quantity,
        sku_lines: [movedLine],
      })
      .select("id")
      .single();
    if (error || !inserted) {
      return NextResponse.json(
        { error: error?.message ?? "Move failed" },
        { status: 500 }
      );
    }
    insertedTargetId = inserted.id;
  }

  const sourceMutation =
    remainingLines.length === 0
      ? await supabase
          .from("multiitem_box_orders")
          .delete()
          .eq("id", sourceOrder.id)
          .eq("tenant_id", ctx.tenant.id)
      : await supabase
          .from("multiitem_box_orders")
          .update({
            sku_lines: remainingLines,
            quantity: sumSkuQuantity(remainingLines),
          })
          .eq("id", sourceOrder.id)
          .eq("tenant_id", ctx.tenant.id);

  if (sourceMutation.error) {
    if (targetOrder) {
      await supabase
        .from("multiitem_box_orders")
        .update({
          sku_lines: targetLines,
          quantity: targetOrder.quantity,
        })
        .eq("id", targetOrder.id)
        .eq("tenant_id", ctx.tenant.id);
    } else if (insertedTargetId) {
      await supabase
        .from("multiitem_box_orders")
        .delete()
        .eq("id", insertedTargetId)
        .eq("tenant_id", ctx.tenant.id);
    }
    return NextResponse.json(
      { error: sourceMutation.error.message },
      { status: 500 }
    );
  }

  await copyCustomerToEmptyBox(supabase, ctx.tenant.id, sourceBox, targetBox);
  return NextResponse.json({
    whole_order: false,
    moved_sku: movedLine,
    source_sku_lines: remainingLines,
    target_sku_lines: nextTargetLines,
  });
}

function sumSkuQuantity(lines: MultiitemBoxSkuLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

async function copyCustomerToEmptyBox(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  sourceBox: {
    customer_id: string | null;
    customer_name: string | null;
    customer_email: string | null;
    customer_phone: string | null;
  },
  targetBox: { id: string; customer_id: string | null }
) {
  if (targetBox.customer_id || !sourceBox.customer_id) return;
  await supabase
    .from("multiitem_boxes")
    .update({
      customer_id: sourceBox.customer_id,
      customer_name: sourceBox.customer_name,
      customer_email: sourceBox.customer_email,
      customer_phone: sourceBox.customer_phone,
    })
    .eq("id", targetBox.id)
    .eq("tenant_id", tenantId);
}
