import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { isSmsConfigured, sendSms, normalizeSmsPhone } from "@/lib/sms";
import { insertOrderSmsMessage } from "@/lib/order-sms";
import { addOrderTag } from "@/lib/order-tags";
import { logActivity } from "@/lib/automation";
import {
  COMBO_STOCK_PHONE,
  buildComboStockSms,
  comboStockCardTag,
  getComboStock,
  withComboStock,
  type ComboStock,
  type ComboStockStatus,
} from "@/lib/combo-stock";

async function loadOrder(orderId: string, tenantId: string) {
  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("id, tenant_id, title, specs")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .is("removed_at", null)
    .maybeSingle();
  return { supabase, order };
}

/** POST — text the warehouse (Jacob) to check combo stock; set status = pending. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSmsConfigured()) {
    return NextResponse.json(
      { error: "SMS is not configured. Add Twilio credentials." },
      { status: 503 }
    );
  }

  const { supabase, order } = await loadOrder(orderId, ctx.tenant.id);
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const specs = order.specs as Record<string, unknown> | null;
  const product =
    typeof specs?.webhook_item_title === "string"
      ? specs.webhook_item_title
      : "";
  const phone = normalizeSmsPhone(COMBO_STOCK_PHONE);
  const messageBody = buildComboStockSms(order.title as string, product);

  const result = await sendSms({ to: phone, body: messageBody });
  if (!result.sent) {
    return NextResponse.json(
      { error: result.error ?? "Failed to send SMS" },
      { status: 502 }
    );
  }

  await insertOrderSmsMessage(supabase, {
    tenantId: ctx.tenant.id,
    orderId,
    direction: "outbound",
    phone,
    body: messageBody,
    twilioSid: result.sid ?? null,
    actorUserId: ctx.userId,
  });

  const stock: ComboStock = {
    status: "pending",
    asked_at: new Date().toISOString(),
    answered_at: null,
    override_by: null,
  };
  const nextSpecs = withComboStock(specs, stock);
  await addOrderTag(
    supabase,
    orderId,
    ctx.tenant.id,
    comboStockCardTag("pending"),
    nextSpecs
  );

  await logActivity(supabase, {
    tenantId: ctx.tenant.id,
    orderId,
    actor: ctx.userId,
    action: "combo_stock_asked",
    metadata: { phone },
  });

  return NextResponse.json({ combo_stock: stock });
}

/**
 * PATCH — set the stock status manually (a manager marking it, or overriding
 * the move block without waiting for the warehouse reply).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as {
    status?: ComboStockStatus;
    override?: boolean;
  };
  const status = payload.status;
  if (
    status !== "pending" &&
    status !== "in_stock" &&
    status !== "ordered" &&
    status !== "cant_get"
  ) {
    return NextResponse.json({ error: "Invalid status" }, { status: 422 });
  }

  const { supabase, order } = await loadOrder(orderId, ctx.tenant.id);
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const specs = order.specs as Record<string, unknown> | null;
  const prev = getComboStock({ specs });
  const stock: ComboStock = {
    status,
    asked_at: prev?.asked_at ?? null,
    answered_at: new Date().toISOString(),
    override_by: payload.override ? ctx.userId : (prev?.override_by ?? null),
  };
  let nextSpecs = withComboStock(specs, stock);
  if (status === "in_stock" || status === "ordered") {
    nextSpecs = {
      ...nextSpecs,
      warehouse_stock_confirmed: true,
      warehouse_stock_confirmed_at: new Date().toISOString(),
      warehouse_stock_confirmed_by:
        (typeof nextSpecs.warehouse_stock_confirmed_by === "string" &&
          nextSpecs.warehouse_stock_confirmed_by) ||
        ctx.userId,
    };
  }
  await addOrderTag(
    supabase,
    orderId,
    ctx.tenant.id,
    comboStockCardTag(status),
    nextSpecs
  );

  await logActivity(supabase, {
    tenantId: ctx.tenant.id,
    orderId,
    actor: ctx.userId,
    action: "combo_stock_set",
    metadata: { status, override: payload.override === true },
  });

  return NextResponse.json({ combo_stock: stock });
}
