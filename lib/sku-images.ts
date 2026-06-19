import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ORDER_ASSETS_BUCKET,
  ORDER_ASSET_SIGNED_URL_TTL_SEC,
  safeAssetFileName,
} from "@/lib/order-assets";
import { skuIds, type SkuItem } from "@/lib/skus";
import type { OrderSkuImage, OrderSkuImageWithUrl } from "@/lib/types";

export const MAX_SKU_IMAGES = 5;

export function skuImageStoragePath(
  tenantId: string,
  orderId: string,
  skuId: string,
  position: number,
  fileName: string
): string {
  const timestamp = Date.now();
  const safeName = safeAssetFileName(fileName);
  return `${tenantId}/${orderId}/skus/${skuId}/${position}-${timestamp}-${safeName}`;
}

export async function listSkuImagesForOrder(
  supabase: SupabaseClient,
  orderId: string
): Promise<OrderSkuImage[]> {
  const { data, error } = await supabase
    .from("order_sku_images")
    .select("*")
    .eq("order_id", orderId)
    .order("position", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as OrderSkuImage[];
}

export async function attachSignedUrlsToSkuImages(
  supabase: SupabaseClient,
  images: OrderSkuImage[]
): Promise<OrderSkuImageWithUrl[]> {
  return Promise.all(
    images.map(async (img) => {
      const { data: signed } = await supabase.storage
        .from(ORDER_ASSETS_BUCKET)
        .createSignedUrl(img.storage_path, ORDER_ASSET_SIGNED_URL_TTL_SEC, {
          download: img.file_name,
        });
      return { ...img, signed_url: signed?.signedUrl ?? null };
    })
  );
}

export function groupSkuImagesBySkuId(
  images: OrderSkuImageWithUrl[]
): Record<string, OrderSkuImageWithUrl[]> {
  const map: Record<string, OrderSkuImageWithUrl[]> = {};
  for (const img of images) {
    (map[img.sku_id] ??= []).push(img);
  }
  return map;
}

/** Remove gallery images whose sku_id is no longer on the order. */
export async function pruneOrphanedSkuImages(
  client: SupabaseClient,
  orderId: string,
  skus: SkuItem[]
) {
  const keep = new Set(skuIds(skus));
  const { data: rows } = await client
    .from("order_sku_images")
    .select("id, storage_path, sku_id")
    .eq("order_id", orderId);

  const toRemove = (rows ?? []).filter(
    (r) => r.sku_id && !keep.has(r.sku_id as string)
  );
  if (toRemove.length === 0) return;

  const paths = toRemove
    .map((r) => r.storage_path as string | null)
    .filter((p): p is string => Boolean(p));
  if (paths.length > 0) {
    await client.storage.from(ORDER_ASSETS_BUCKET).remove(paths);
  }
  await client
    .from("order_sku_images")
    .delete()
    .in(
      "id",
      toRemove.map((r) => r.id as string)
    );
}
