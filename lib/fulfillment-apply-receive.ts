import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/automation";
import {
  columnIdForReceiveStatus,
  type FulfillmentReceiveColumns,
  type FulfillmentReceiveStatus,
} from "@/lib/fulfillment-receive-status";

export async function applyFulfillmentReceiveStatus(
  supabase: SupabaseClient,
  opts: {
    tenantId: string;
    userId: string;
    boxId: string;
    orderId: string;
    status: FulfillmentReceiveStatus;
    quantityReceived?: number | null;
    settings: FulfillmentReceiveColumns;
  }
): Promise<{ error: string | null }> {
  const patch: Record<string, unknown> = {
    receive_status: opts.status,
  };
  if (
    opts.quantityReceived != null &&
    Number.isFinite(opts.quantityReceived)
  ) {
    patch.quantity_received = Math.floor(opts.quantityReceived);
  }

  const { error } = await supabase
    .from("fulfillment_box_orders")
    .update(patch)
    .eq("box_id", opts.boxId)
    .eq("order_id", opts.orderId)
    .eq("tenant_id", opts.tenantId);

  if (error) return { error: error.message };

  const columnId = columnIdForReceiveStatus(opts.status, opts.settings);
  if (columnId) {
    const { error: moveError } = await supabase
      .from("orders")
      .update({ column_id: columnId })
      .eq("id", opts.orderId)
      .eq("tenant_id", opts.tenantId);
    if (moveError) return { error: moveError.message };
  }

  try {
    await logActivity(supabase, {
      tenantId: opts.tenantId,
      orderId: opts.orderId,
      actor: opts.userId,
      action: "fulfillment:receive_status",
      metadata: {
        box_id: opts.boxId,
        receive_status: opts.status,
      },
    });
  } catch {
    /* non-fatal */
  }

  return { error: null };
}

export async function applyFulfillmentBoxReceive(
  supabase: SupabaseClient,
  opts: {
    tenantId: string;
    userId: string;
    boxId: string;
    status: FulfillmentReceiveStatus;
    comment?: string | null;
    quantities?: Map<string, number>;
    settings: FulfillmentReceiveColumns;
  }
): Promise<{ error: string | null }> {
  const comment =
    typeof opts.comment === "string" ? opts.comment.trim().slice(0, 2000) : null;

  const boxPatch: Record<string, unknown> = {
    receive_status: opts.status,
  };
  if (opts.comment !== undefined) {
    boxPatch.receive_comment = comment || null;
  }

  const { error: boxError } = await supabase
    .from("fulfillment_boxes")
    .update(boxPatch)
    .eq("id", opts.boxId)
    .eq("tenant_id", opts.tenantId);

  if (boxError) return { error: boxError.message };

  const { data: rows, error: listError } = await supabase
    .from("fulfillment_box_orders")
    .select("order_id, quantity_expected")
    .eq("box_id", opts.boxId)
    .eq("tenant_id", opts.tenantId);

  if (listError) return { error: listError.message };

  for (const row of rows ?? []) {
    const qty = opts.quantities?.get(row.order_id);
    const { error } = await applyFulfillmentReceiveStatus(supabase, {
      tenantId: opts.tenantId,
      userId: opts.userId,
      boxId: opts.boxId,
      orderId: row.order_id,
      status: opts.status,
      quantityReceived: qty ?? null,
      settings: opts.settings,
    });
    if (error) return { error };
  }

  return { error: null };
}
