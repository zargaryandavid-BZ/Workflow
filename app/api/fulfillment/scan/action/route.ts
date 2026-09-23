import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { createClient } from "@/lib/supabase/server";
import {
  findScanButton,
  normalizeScanButtons,
} from "@/lib/fulfillment-scan-config";

/**
 * POST /api/fulfillment/scan/action
 *
 * Body: { order_id: string, button_id: string }
 * (`action` is accepted as an alias for `button_id`.)
 *
 * Looks up the target column from fulfillment_settings.scan_column_config,
 * moves the order, and returns the new column_id + column_name.
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

  // Verify order belongs to tenant
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, column_id")
    .eq("id", body.order_id)
    .eq("tenant_id", ctx.tenant.id)
    .is("removed_at", null)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Verify target column belongs to tenant
  const { data: column, error: colError } = await supabase
    .from("board_columns")
    .select("id, name")
    .eq("id", targetColumnId)
    .eq("tenant_id", ctx.tenant.id)
    .single();

  if (colError || !column) {
    return NextResponse.json({ error: "Target column not found" }, { status: 404 });
  }

  // Move order
  const { error: updateError } = await supabase
    .from("orders")
    .update({ column_id: targetColumnId })
    .eq("id", body.order_id)
    .eq("tenant_id", ctx.tenant.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    order_id: body.order_id,
    button_id: button.id,
    action: button.id,
    column_id: (column as { id: string; name: string }).id,
    column_name: (column as { id: string; name: string }).name,
  });
}
