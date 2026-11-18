import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/automation";
import { withWebhookOrderIngestLock } from "@/lib/webhook-order-lock";

/** Stamped on cards removed by a CRM cancel; blocks re-creating the order. */
export const CRM_CANCELLED_AT_SPEC = "crm_cancelled_at";

/**
 * Cancels every board job that belongs to a CRM order, in response to an
 * `order.canceled` webhook. Jobs are matched exactly the way the inbound-order
 * webhook dedupes them — by `specs->>webhook_order_number` within the tenant —
 * and soft-removed (the same `removed_at` mechanism the manual "remove order"
 * action uses), so they drop off the active production board.
 *
 * Runs under the same ingest lock as order creation, so a cancel that arrives
 * while the create is still running waits for it and then removes its cards.
 *
 * Idempotent: already-removed jobs are skipped, so a repeated cancel is a no-op.
 */
export async function cancelOrdersFromWebhook(
  client: SupabaseClient,
  tenantId: string,
  webhookOrderNumber: string,
  actor: string,
): Promise<{ cancelled: number; orderIds: string[] }> {
  return withWebhookOrderIngestLock(client, tenantId, webhookOrderNumber, () =>
    cancelOrdersLocked(client, tenantId, webhookOrderNumber, actor)
  );
}

async function cancelOrdersLocked(
  client: SupabaseClient,
  tenantId: string,
  webhookOrderNumber: string,
  actor: string,
): Promise<{ cancelled: number; orderIds: string[] }> {
  const { data: rows, error: findError } = await client
    .from("orders")
    .select("id, specs")
    .eq("tenant_id", tenantId)
    .is("removed_at", null)
    .filter("specs->>webhook_order_number", "eq", webhookOrderNumber);
  if (findError) throw new Error(findError.message);

  const live = (rows ?? []) as {
    id: string;
    specs: Record<string, unknown> | null;
  }[];
  if (live.length === 0) return { cancelled: 0, orderIds: [] };

  // Hayk 2026-11-13: a voided / cancelled order should show as CANCELED on the
  // board. When the tenant has a "Canceled"/"Cancelled" column, move the cards
  // there (still visible, clearly marked). Otherwise keep the old behaviour:
  // soft-remove them from the board.
  const canceledColumn = await resolveCanceledColumn(client, tenantId);
  const stampedAt = new Date().toISOString();
  for (const row of live) {
    const specs = { ...(row.specs ?? {}), [CRM_CANCELLED_AT_SPEC]: stampedAt };
    const patch = canceledColumn
      ? { column_id: canceledColumn.id, last_moved_at: stampedAt, specs }
      : { removed_at: stampedAt, specs };
    const { error: updateError } = await client
      .from("orders")
      .update(patch)
      .eq("id", row.id)
      .eq("tenant_id", tenantId);
    if (updateError) throw new Error(updateError.message);
  }

  const orderIds = live.map((r) => r.id);
  for (const row of live) {
    if (canceledColumn) {
      await logActivity(client, {
        tenantId,
        orderId: row.id,
        actor,
        action: "moved",
        metadata: {
          to: canceledColumn.id,
          toName: canceledColumn.name,
          via: "order_canceled",
          webhook_order_number: webhookOrderNumber,
        },
      });
    }
    await logActivity(client, {
      tenantId,
      orderId: row.id,
      actor,
      action: "hold_reason",
      metadata: {
        reason: "Order was voided / cancelled at the source (website, portal or CRM).",
        columnName: canceledColumn?.name ?? "Canceled",
        auto: true,
        via: "order_canceled",
        webhook_order_number: webhookOrderNumber,
      },
    });
  }

  return { cancelled: orderIds.length, orderIds };
}

/** The tenant's Canceled / Cancelled column, if it has one. */
async function resolveCanceledColumn(
  client: SupabaseClient,
  tenantId: string,
): Promise<{ id: string; name: string } | null> {
  const { data } = await client
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", tenantId);
  const cols = (data ?? []) as { id: string; name: string | null }[];
  const hit = cols.find((c) => /\bcancell?ed\b/i.test(c.name ?? ""));
  return hit ? { id: hit.id, name: hit.name ?? "Canceled" } : null;
}

/** True when this CRM order was cancelled and all its cards removed. */
export async function isCrmCancelledOrder(
  client: SupabaseClient,
  tenantId: string,
  webhookOrderNumber: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .filter("specs->>webhook_order_number", "eq", webhookOrderNumber)
    .not(`specs->>${CRM_CANCELLED_AT_SPEC}`, "is", null)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
