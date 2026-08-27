import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { RespondOrderAsset, RespondSkuImage } from "@/lib/respond-order";

/**
 * Staff-uploaded order + SKU artwork shown to the customer. Excludes customer
 * reply uploads (notification_id set) and locked reference images (the
 * CRM/manager attachment, is_locked) which are internal-only.
 */
export async function fetchRespondOrderAssets(
  orderId: string
): Promise<RespondOrderAsset[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("assets")
    .select("id, file_name, mime_type, sku_key, size, is_locked")
    .eq("order_id", orderId)
    .is("notification_id", null)
    .order("created_at", { ascending: true });

  return ((data ?? []) as (RespondOrderAsset & { is_locked?: boolean })[]).filter(
    (a) => !a.is_locked
  );
}

/** Multi-image gallery images from order_sku_images, grouped by sku_id. */
export async function fetchRespondSkuImages(
  orderId: string
): Promise<Record<string, RespondSkuImage[]>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("order_sku_images")
    .select("id, sku_id, file_name, mime_type, file_size")
    .eq("order_id", orderId)
    .order("position", { ascending: true });

  const grouped: Record<string, RespondSkuImage[]> = {};
  for (const row of (data ?? []) as RespondSkuImage[]) {
    (grouped[row.sku_id] ??= []).push(row);
  }
  return grouped;
}
