import type { SupabaseClient } from "@supabase/supabase-js";
import { skuIds, type SkuItem } from "@/lib/skus";

const BUCKET = "order-assets";

/** Remove artwork assets whose sku_key is no longer on the order. */
export async function pruneOrphanedSkuAssets(
  client: SupabaseClient,
  orderId: string,
  skus: SkuItem[]
) {
  const keep = new Set(skuIds(skus));
  const { data: rows } = await client
    .from("assets")
    .select("id, storage_path, sku_key")
    .eq("order_id", orderId)
    .not("sku_key", "is", null);

  const toRemove = (rows ?? []).filter(
    (r) => r.sku_key && !keep.has(r.sku_key as string)
  );
  if (toRemove.length === 0) return;

  await client.storage
    .from(BUCKET)
    .remove(toRemove.map((r) => r.storage_path as string));
  await client
    .from("assets")
    .delete()
    .in(
      "id",
      toRemove.map((r) => r.id as string)
    );
}

export async function uploadPendingSkuArtwork(
  orderId: string,
  pending: Record<string, File>
) {
  for (const [skuKey, file] of Object.entries(pending)) {
    const form = new FormData();
    form.append("file", file);
    form.append("orderId", orderId);
    form.append("skuKey", skuKey);
    await fetch("/api/assets/upload", { method: "POST", body: form });
  }
}

export async function uploadPendingOrderAssets(orderId: string, files: File[]) {
  for (const file of files) {
    const form = new FormData();
    form.append("file", file);
    form.append("orderId", orderId);
    await fetch("/api/assets/upload", { method: "POST", body: form });
  }
}

export async function deleteAssetsById(assetIds: string[]) {
  for (const id of assetIds) {
    await fetch(`/api/assets/${id}`, { method: "DELETE" });
  }
}
