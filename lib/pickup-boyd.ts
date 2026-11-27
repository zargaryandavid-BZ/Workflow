import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Board column that means "scanned in at the Boyd St shop". */
const BOYD_RECEIVED = /\bboyd\s+received\b/i;

/**
 * Whether any of these orders was scanned in at Boyd — it sits in the
 * "Boyd Received" column now, or was moved there at some point.
 */
export async function ordersScannedAtBoyd(
  client: SupabaseClient,
  tenantId: string,
  orderIds: string[]
): Promise<boolean> {
  const ids = [...new Set(orderIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return false;

  const { data: columns, error: colErr } = await client
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", tenantId);
  if (colErr) return false;
  const boydIds = (columns ?? [])
    .filter((c) => BOYD_RECEIVED.test(String((c as { name?: string }).name ?? "")))
    .map((c) => String((c as { id: string }).id));
  if (boydIds.length === 0) return false;

  const { data: current } = await client
    .from("orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("id", ids)
    .in("column_id", boydIds)
    .limit(1);
  if ((current ?? []).length > 0) return true;

  const { data: moves } = await client
    .from("activity_log")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("action", "moved")
    .in("order_id", ids)
    .in("metadata->>to", boydIds)
    .limit(1);
  return (moves ?? []).length > 0;
}
