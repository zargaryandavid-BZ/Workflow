import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { orderCardThumbnails } from "@/lib/board-order-enrichment";
import { firstThumbnailUrl } from "@/lib/card-image";

/** Board card pictures (all-layer composite) keyed by order id. */
export async function boxOrderThumbnailUrls(
  supabase: SupabaseClient,
  orderIds: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(orderIds.map((id) => id.trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;

  const { data } = await supabase
    .from("orders")
    .select("id, specs")
    .in("id", unique);

  const thumbs = await orderCardThumbnails(supabase, data ?? []);
  for (const id of unique) {
    const url = firstThumbnailUrl(thumbs[id]);
    if (url) map.set(id, url);
  }
  return map;
}
