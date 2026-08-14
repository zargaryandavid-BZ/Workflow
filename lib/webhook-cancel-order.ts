import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/automation";

/**
 * Cancels every board job that belongs to a CRM order, in response to an
 * `order.canceled` webhook. Jobs are matched exactly the way the inbound-order
 * webhook dedupes them — by `specs->>webhook_order_number` within the tenant —
 * and soft-removed (the same `removed_at` mechanism the manual "remove order"
 * action uses), so they drop off the active production board.
 *
 * Idempotent: already-removed jobs are skipped, so a repeated cancel is a no-op.
 */
export async function cancelOrdersFromWebhook(
  client: SupabaseClient,
  tenantId: string,
  webhookOrderNumber: string,
  actor: string,
): Promise<{ cancelled: number; orderIds: string[] }> {
  const { data: rows, error: findError } = await client
    .from("orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .is("removed_at", null)
    .filter("specs->>webhook_order_number", "eq", webhookOrderNumber);
  if (findError) throw new Error(findError.message);

  const orderIds = (rows ?? []).map((r) => r.id as string);
  if (orderIds.length === 0) return { cancelled: 0, orderIds: [] };

  const removedAt = new Date().toISOString();
  const { error: updateError } = await client
    .from("orders")
    .update({ removed_at: removedAt })
    .in("id", orderIds)
    .eq("tenant_id", tenantId);
  if (updateError) throw new Error(updateError.message);

  for (const orderId of orderIds) {
    await logActivity(client, {
      tenantId,
      orderId,
      actor,
      action: "Order cancelled in CRM — removed from board",
      metadata: { webhook_order_number: webhookOrderNumber },
    });
  }

  return { cancelled: orderIds.length, orderIds };
}
