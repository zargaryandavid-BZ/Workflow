import { after, NextResponse } from "next/server";
import {
  findScanButton,
  normalizeScanButtons,
} from "@/lib/fulfillment-scan-config";
import { resolveKioskTenant } from "@/lib/kiosk-token";
import { logActivity, onEnterColumn } from "@/lib/automation";
import { maybeStopPrepressTimersOnColumnLeave } from "@/lib/stop-order-timers";
import { fireNotificationRules } from "@/lib/fire-notification-rules";
import {
  isFulfilledStage,
  notifyCrmOrderFulfilled,
} from "@/lib/net-terms-fulfill";
import { notifyCustomerOrderFinished } from "@/lib/finished-order-sms";
import type { Order, BoardColumn } from "@/lib/types";

/**
 * POST /api/kiosk/[token]/action
 *
 * Public floor move. Same post-move hooks as /api/fulfillment/scan/action.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: rawToken } = await params;
  const kiosk = await resolveKioskTenant(rawToken);
  if (!kiosk) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { supabase, tenantId } = kiosk;

  const body = (await request.json().catch(() => ({}))) as {
    order_id?: string;
    button_id?: string;
    action?: string;
  };

  if (!body.order_id?.trim()) {
    return NextResponse.json({ error: "order_id is required" }, { status: 400 });
  }
  const buttonId = (body.button_id ?? body.action ?? "").trim();
  if (!buttonId) {
    return NextResponse.json({ error: "button_id is required" }, { status: 400 });
  }

  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();
  const tenantName = (tenantRow as { name: string } | null)?.name ?? "";

  const buttons = normalizeScanButtons(kiosk.scanColumnConfig);
  const button = findScanButton(buttons, buttonId);
  const targetColumnId = button?.columnId ?? null;

  if (!button) {
    return NextResponse.json({ error: "Unknown scan action" }, { status: 400 });
  }
  if (!targetColumnId) {
    return NextResponse.json(
      {
        error: `Column not configured for "${button.label}". Set it in Configure columns.`,
      },
      { status: 422 }
    );
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", body.order_id)
    .eq("tenant_id", tenantId)
    .is("removed_at", null)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const { data: column, error: colError } = await supabase
    .from("board_columns")
    .select("*")
    .eq("id", targetColumnId)
    .eq("tenant_id", tenantId)
    .single();

  if (colError || !column) {
    return NextResponse.json({ error: "Target column not found" }, { status: 404 });
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      column_id: targetColumnId,
      last_moved_at: new Date().toISOString(),
    })
    .eq("id", body.order_id)
    .eq("tenant_id", tenantId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const { data: sourceColumn } = await supabase
    .from("board_columns")
    .select("name")
    .eq("id", order.column_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  await maybeStopPrepressTimersOnColumnLeave({
    tenantId,
    orderId: body.order_id,
    fromColumn: {
      name: (sourceColumn as { name?: string } | null)?.name,
    },
    toColumn: { name: (column as BoardColumn).name },
  });

  const movedOrder = { ...order, column_id: targetColumnId } as Order;
  const typedColumn = column as BoardColumn;

  after(async () => {
    try {
      await logActivity(supabase, {
        tenantId,
        orderId: movedOrder.id,
        actor: null,
        action: "moved",
        metadata: {
          from: order.column_id,
          to: targetColumnId,
          toName: typedColumn.name,
          via: "kiosk_scan",
        },
      });
    } catch (err) {
      console.error("[kiosk/action] logActivity failed:", err);
    }
    try {
      await onEnterColumn(supabase, movedOrder, typedColumn, tenantName, null);
    } catch (err) {
      console.error("[kiosk/action] onEnterColumn failed:", err);
    }
    try {
      await fireNotificationRules(movedOrder.id, targetColumnId, tenantId);
    } catch (err) {
      console.error("[kiosk/action] fireNotificationRules failed:", err);
    }
    try {
      if (isFulfilledStage(typedColumn.name)) {
        await notifyCrmOrderFulfilled(movedOrder, typedColumn.name);
      }
    } catch (err) {
      console.error("[kiosk/action] notifyCrmOrderFulfilled failed:", err);
    }
    try {
      if (isFulfilledStage(typedColumn.name)) {
        await notifyCustomerOrderFinished(movedOrder, typedColumn.name);
      }
    } catch (err) {
      console.error("[kiosk/action] notifyCustomerOrderFinished failed:", err);
    }
  });

  return NextResponse.json({
    success: true,
    order_id: body.order_id,
    button_id: button.id,
    action: button.id,
    column_id: typedColumn.id,
    column_name: typedColumn.name,
  });
}
