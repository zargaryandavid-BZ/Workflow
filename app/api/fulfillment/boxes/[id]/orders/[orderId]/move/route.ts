import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; orderId: string }> }
) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const { id: fromBoxId, orderId } = await params;
  const body = (await request.json().catch(() => ({}))) as { toBoxId?: string };
  const toBoxId = body.toBoxId?.trim() ?? "";
  if (!toBoxId) {
    return NextResponse.json({ error: "toBoxId is required" }, { status: 400 });
  }
  if (toBoxId === fromBoxId) {
    return NextResponse.json({ error: "Order is already in that box" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: boxes, error: boxesError } = await supabase
    .from("fulfillment_boxes")
    .select("id, status")
    .eq("tenant_id", ctx.tenant.id)
    .in("id", [fromBoxId, toBoxId]);

  if (boxesError) {
    return NextResponse.json({ error: boxesError.message }, { status: 500 });
  }

  const fromBox = boxes?.find((b) => b.id === fromBoxId);
  const toBox = boxes?.find((b) => b.id === toBoxId);
  if (!fromBox || !toBox) {
    return NextResponse.json({ error: "Box not found" }, { status: 404 });
  }
  if (fromBox.status !== "open" || toBox.status !== "open") {
    return NextResponse.json(
      { error: "Cannot move between sent or received boxes" },
      { status: 400 }
    );
  }

  const { data: existing, error: existingError } = await supabase
    .from("fulfillment_box_orders")
    .select("id")
    .eq("box_id", toBoxId)
    .eq("order_id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json(
      { error: "Order already in the target box" },
      { status: 409 }
    );
  }

  const { data: moved, error: moveError } = await supabase
    .from("fulfillment_box_orders")
    .update({ box_id: toBoxId })
    .eq("box_id", fromBoxId)
    .eq("order_id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .select()
    .single();

  if (moveError || !moved) {
    return NextResponse.json(
      { error: moveError?.message ?? "Order not in this box" },
      { status: 404 }
    );
  }

  return NextResponse.json(moved);
}
