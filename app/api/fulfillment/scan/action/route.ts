import { after, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { createClient } from "@/lib/supabase/server";
import {
  findScanButton,
  normalizeScanButtons,
} from "@/lib/fulfillment-scan-config";
import { logActivity, onEnterColumn } from "@/lib/automation";
import { fireNotificationRules } from "@/lib/fire-notification-rules";
import {
  isFulfilledStage,
  notifyCrmOrderFulfilled,
} from "@/lib/net-terms-fulfill";
import { notifyCustomerOrderFinished } from "@/lib/finished-order-sms";
import type { Order, BoardColumn } from "@/lib/types";

/**
 * POST /api/fulfillment/scan/action
 *
 * Body: { order_id: string, button_id: string }
 * (`action` is accepted as an alias for `button_id`.)
 *
 * Looks up the target column from fulfillment_settings.scan_column_config,
 * moves the order, and returns the new column_id + column_name.
 *
 * Fires the same post-move hooks as the board move route:
 * onEnterColumn (hold watchers, timer stops), fireNotificationRules (SMS
 * automation rules), and notifyCustomerOrderFinished (finished-stage SMS).
 */
export async function POST(request: Request) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = await request.json().catch(() => ({})) as {
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

  const supabase = await createClient();

  const { data: settings } = await supabase
    .from("fulfillment_settings")
    .select("scan_column_config")
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  const buttons = normalizeScanButtons(settings?.scan_column_config);
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

  // Fetch full order so post-move hooks (SMS, automation rules) have what they need
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", body.order_id)
    .eq("tenant_id", ctx.tenant.id)
    .is("removed_at", null)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Fetch full column so onEnterColumn gets kind + other fields
  const { data: column, error: colError } = await supabase
    .from("board_columns")
    .select("*")
    .eq("id", targetColumnId)
    .eq("tenant_id", ctx.tenant.id)
    .single();

  if (colError || !column) {
    return NextResponse.json({ error: "Target column not found" }, { status: 404 });
  }

  // Move order, updating last_moved_at so board sort stays consistent
  const { error: updateError } = await supabase
    .from("orders")
    .update({
      column_id: targetColumnId,
      last_moved_at: new Date().toISOString(),
    })
    .eq("id", body.order_id)
    .eq("tenant_id", ctx.tenant.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Fire post-move hooks asynchronously (same pattern as /api/orders/move)
  const movedOrder = { ...order, column_id: targetColumnId } as Order;
  const typedColumn = column as BoardColumn;
  const tenantId = ctx.tenant.id;
  const tenantName = ctx.tenant.name;

  after(async () => {
    try {
      await logActivity(supabase, {
        tenantId,
        orderId: movedOrder.id,
        actor: null, // fulfillment scan has no user actor
        action: "moved",
        metadata: {
          from: order.column_id,
          to: targetColumnId,
          toName: typedColumn.name,
          via: "fulfillment_scan",
        },
      });
    } catch (err) {
      console.error("[scan/action] logActivity failed:", err instanceof Error ? err.message : err);
    }
    try {
      await onEnterColumn(supabase, movedOrder, typedColumn, tenantName, null);
    } catch (err) {
      console.error("[scan/action] onEnterColumn failed:", err instanceof Error ? err.message : err);
    }
    try {
      await fireNotificationRules(movedOrder.id, targetColumnId, tenantId);
    } catch (err) {
      console.error("[scan/action] fireNotificationRules failed:", err instanceof Error ? err.message : err);
    }
    try {
      if (isFulfilledStage(typedColumn.name)) {
        await notifyCrmOrderFulfilled(movedOrder, typedColumn.name);
      }
    } catch (err) {
      console.error("[scan/action] notifyCrmOrderFulfilled failed:", err instanceof Error ? err.message : err);
    }
    try {
      if (isFulfilledStage(typedColumn.name)) {
        await notifyCustomerOrderFinished(movedOrder, typedColumn.name);
      }
    } catch (err) {
      console.error("[scan/action] notifyCustomerOrderFinished failed:", err instanceof Error ? err.message : err);
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
