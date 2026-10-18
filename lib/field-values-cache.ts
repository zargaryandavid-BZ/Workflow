import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rememberMany } from "@/lib/cache";

/**
 * Cached per-order custom-field values for the board.
 *
 * Re-reading every card's custom fields on every board refresh was the single
 * highest-total-time query in the database. These values change rarely relative
 * to how often the board refreshes, so we cache them per order for a SHORT
 * window (30s) — shorter than the board's own 60s fallback poll, so the board
 * is never more stale than it already is. No explicit invalidation is needed:
 * the short TTL self-heals, and a staff member editing a field sees it live in
 * the order's detail view (which reads the order directly, not this board cache).
 *
 * Returns the SAME `{ data: Row[] }` shape as the old inline query, so the
 * caller is unchanged. Best-effort: any cache error falls back to a direct DB
 * read — it can never change what data is returned, only how fast.
 */

type CfvRow = { order_id: string; custom_field_id: string; value: unknown };
type PerOrder = { custom_field_id: string; value: unknown }[];

const TTL_SECONDS = 30;
const keyFor = (orderId: string) => `wf:cfv:v2:${orderId}`;

export async function getCachedFieldValues(
  supabase: SupabaseClient,
  orderIds: string[]
): Promise<{ data: CfvRow[] }> {
  if (orderIds.length === 0) return { data: [] };

  const keys = orderIds.map(keyFor);
  const keyToOrder = new Map(orderIds.map((id) => [keyFor(id), id]));

  try {
    const byKey = await rememberMany<PerOrder>(
      keys,
      TTL_SECONDS,
      async (missKeys) => {
        const missOrderIds = missKeys
          .map((k) => keyToOrder.get(k))
          .filter((id): id is string => Boolean(id));
        const { data, error } = await supabase
          .from("custom_field_values")
          .select("order_id, custom_field_id, value")
          .in("order_id", missOrderIds);
        if (error) throw new Error(error.message); // don't cache a failed read
        // Start every missing order at [] so orders with no values are cached
        // too (otherwise they'd be re-queried on every refresh forever).
        const grouped: Record<string, PerOrder> = {};
        for (const id of missOrderIds) grouped[keyFor(id)] = [];
        for (const r of (data ?? []) as CfvRow[]) {
          (grouped[keyFor(r.order_id)] ??= []).push({
            custom_field_id: r.custom_field_id,
            value: r.value,
          });
        }
        return grouped;
      }
    );

    const rows: CfvRow[] = [];
    for (const [k, perOrder] of Object.entries(byKey)) {
      const orderId = keyToOrder.get(k);
      if (!orderId || !Array.isArray(perOrder)) continue;
      for (const item of perOrder) {
        rows.push({
          order_id: orderId,
          custom_field_id: item.custom_field_id,
          value: item.value,
        });
      }
    }
    return { data: rows };
  } catch {
    // Any failure → plain uncached read, exactly the old behavior.
    const { data } = await supabase
      .from("custom_field_values")
      .select("order_id, custom_field_id, value")
      .in("order_id", orderIds);
    return { data: (data ?? []) as CfvRow[] };
  }
}
