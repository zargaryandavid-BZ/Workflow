import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  confirmWarehouseStockInApp,
  requestWarehouseStockConfirmation,
} from "@/lib/warehouse-stock.server";
import {
  orderIsWithApplication,
  warehouseStockSmsSent,
} from "@/lib/warehouse-stock";
import type { CustomField, Order } from "@/lib/types";

export const runtime = "nodejs";

/**
 * In-app warehouse stock action for a with-application (combo) order.
 * - default: mark the containers confirmed so the order can advance.
 * - { resend: true }: re-text the warehouse the confirm link instead.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    resend?: boolean;
  };

  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  const order = data as Order | null;
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Reliable detection: use the Application checkbox / Combos category, and also
  // accept orders the gate already flagged (a confirm text was requested).
  const [{ data: fields }, { data: values }] = await Promise.all([
    supabase
      .from("custom_fields")
      .select("*")
      .eq("tenant_id", ctx.tenant.id),
    supabase
      .from("custom_field_values")
      .select("custom_field_id, value")
      .eq("order_id", orderId),
  ]);
  const fieldValues: Record<string, unknown> = {};
  for (const row of (values ?? []) as {
    custom_field_id: string;
    value: unknown;
  }[]) {
    fieldValues[row.custom_field_id] = row.value;
  }

  const isCombo =
    orderIsWithApplication(
      order.specs,
      (fields ?? []) as CustomField[],
      fieldValues
    ) || warehouseStockSmsSent(order.specs);

  if (!isCombo) {
    return NextResponse.json(
      { error: "This order does not require warehouse stock confirmation." },
      { status: 400 }
    );
  }

  if (body.resend) {
    const stockReq = await requestWarehouseStockConfirmation(supabase, {
      orderId: order.id,
      tenantId: ctx.tenant.id,
      title: order.title,
      specs: order.specs,
      orderNumber: null,
      tenantName: ctx.tenant.name,
      actorUserId: ctx.userId,
      force: true,
    });
    return NextResponse.json({
      ok: true,
      resent: true,
      warehouse_notified: stockReq.smsSent,
      warehouse_notify_error: stockReq.error ?? null,
    });
  }

  const result = await confirmWarehouseStockInApp(supabase, {
    orderId: order.id,
    tenantId: ctx.tenant.id,
    specs: order.specs,
    confirmedBy: ctx.fullName || ctx.email || "warehouse",
    actorUserId: ctx.userId,
  });

  return NextResponse.json({
    ok: true,
    alreadyConfirmed: result.alreadyConfirmed,
  });
}
