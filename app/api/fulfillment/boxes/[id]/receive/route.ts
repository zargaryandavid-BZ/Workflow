import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { createClient } from "@/lib/supabase/server";
import { applyFulfillmentBoxReceive } from "@/lib/fulfillment-apply-receive";
import {
  defaultBoxReceiveStatus,
  isFulfillmentReceiveStatus,
  type FulfillmentReceiveStatus,
} from "@/lib/fulfillment-receive-status";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const { id: boxId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    status?: string;
    comment?: string | null;
    quantities?: {
      orderId?: string;
      order_id?: string;
      quantity: number;
    }[];
  };

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
  if (box.status !== "sent") {
    return NextResponse.json(
      { error: "Box must be in 'sent' status to receive" },
      { status: 400 }
    );
  }

  const { data: settings } = await supabase
    .from("fulfillment_settings")
    .select("receive_column_id, counted_column_id, missing_column_id")
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  const columns = {
    receive_column_id: settings?.receive_column_id ?? null,
    counted_column_id: settings?.counted_column_id ?? null,
    missing_column_id: settings?.missing_column_id ?? null,
  };

  const { data: boxOrders } = await supabase
    .from("fulfillment_box_orders")
    .select("order_id, quantity_expected")
    .eq("box_id", boxId)
    .eq("tenant_id", ctx.tenant.id);

  const qtyByOrder = new Map<string, number>();
  const qtyLines: { expected: number; received: number }[] = [];
  for (const row of boxOrders ?? []) {
    const incoming = (body.quantities ?? []).find(
      (q) => (q.orderId ?? q.order_id) === row.order_id
    );
    const quantity = incoming?.quantity ?? row.quantity_expected ?? 0;
    const expected = row.quantity_expected ?? quantity;
    qtyByOrder.set(row.order_id, quantity);
    qtyLines.push({ expected, received: quantity });
  }

  const status: FulfillmentReceiveStatus = isFulfillmentReceiveStatus(
    body.status
  )
    ? body.status
    : defaultBoxReceiveStatus(qtyLines);

  const { error } = await applyFulfillmentBoxReceive(supabase, {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    boxId,
    status,
    comment: body.comment ?? null,
    quantities: qtyByOrder,
    settings: columns,
  });
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const { data: receivedBox, error: boxUpdateError } = await supabase
    .from("fulfillment_boxes")
    .update({
      status: "received",
      received_at: new Date().toISOString(),
      received_by: ctx.userId,
    })
    .eq("id", boxId)
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "sent")
    .select("id")
    .maybeSingle();

  if (boxUpdateError) {
    return NextResponse.json({ error: boxUpdateError.message }, { status: 500 });
  }
  if (!receivedBox) {
    return NextResponse.json(
      { error: "Box is no longer in sent status" },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true });
}
