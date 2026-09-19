import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { applyFulfillmentReceiveStatus } from "@/lib/fulfillment-apply-receive";
import {
  isFulfillmentReceiveStatus,
} from "@/lib/fulfillment-receive-status";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; orderId: string }> }
) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const { id: boxId, orderId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    status?: unknown;
    quantity?: unknown;
  };
  if (!isFulfillmentReceiveStatus(body.status)) {
    return NextResponse.json(
      { error: "status must be received, counted, or missing" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data: box, error: boxError } = await supabase
    .from("fulfillment_boxes")
    .select("id, status")
    .eq("id", boxId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (boxError || !box) {
    return NextResponse.json({ error: "Box not found" }, { status: 404 });
  }
  if (box.status !== "sent" && box.status !== "received") {
    return NextResponse.json(
      { error: "Box is not in receive" },
      { status: 400 }
    );
  }

  const { data: settings } = await supabase
    .from("fulfillment_settings")
    .select("receive_column_id, counted_column_id, missing_column_id")
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  const qty = Math.floor(Number(body.quantity));
  const { error } = await applyFulfillmentReceiveStatus(supabase, {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    boxId,
    orderId,
    status: body.status,
    quantityReceived: Number.isFinite(qty) ? qty : null,
    settings: {
      receive_column_id: settings?.receive_column_id ?? null,
      counted_column_id: settings?.counted_column_id ?? null,
      missing_column_id: settings?.missing_column_id ?? null,
    },
  });

  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json({ ok: true, status: body.status });
}
