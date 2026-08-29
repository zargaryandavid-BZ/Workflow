import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ORDER_ASSETS_BUCKET,
  ORDER_ASSET_SIGNED_URL_TTL_SEC,
  safeAssetFileName,
} from "@/lib/order-assets";
import { skuIds, type SkuItem } from "@/lib/skus";
import type { Asset, OrderSkuImage, OrderSkuImageWithUrl } from "@/lib/types";
import { canonicalArtworkUrl } from "@/lib/webhook-artwork";

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
  if (images.length === 0) return [];

  const paths = images
    .map((img) => img.storage_path)
    .filter((p): p is string => Boolean(p?.trim()));

  // One storage round-trip instead of N createSignedUrl calls.
  const urlByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from(ORDER_ASSETS_BUCKET)
      .createSignedUrls(paths, ORDER_ASSET_SIGNED_URL_TTL_SEC);
    for (const row of signed ?? []) {
      if (row.path && row.signedUrl && !row.error) {
        urlByPath.set(row.path, row.signedUrl);
      }
    }
  }

  return images.map((img) => ({
    ...img,
    signed_url: img.storage_path
      ? (urlByPath.get(img.storage_path) ?? null)
      : null,
  }));
}

/**
 * Webhook artwork is stored on `assets` (often with `external_url` + `sku_key`).
 * The card SKU gallery only reads `order_sku_images`, so merge those assets in.
 */
export function skuImagesFromAssets(
  assets: Asset[],
  opts?: { soleSkuId?: string | null }
): OrderSkuImageWithUrl[] {
  const soleSkuId = opts?.soleSkuId?.trim() || null;
  const out: OrderSkuImageWithUrl[] = [];
  let position = 10_000;

  for (const asset of assets) {
    if (asset.notification_id) continue;
    const skuId = (asset.sku_key?.trim() || soleSkuId) ?? "";
    if (!skuId) continue;

    // Prefer stored bytes when present: external_url is kept after download for
    // idempotency, but portal artwork URLs are auth-gated (osk_ header) and 401
    // in the browser. `/api/assets/[id]` serves a signed storage URL.
    const hasStorage = Boolean(asset.storage_path?.trim());
    const external = asset.external_url?.trim() || null;
    const fingerprint =
      (hasStorage ? `sp:${asset.storage_path!.trim()}` : "") ||
      (external ? `url:${canonicalArtworkUrl(external)}` : "") ||
      `id:${asset.id}`;
    out.push({
      id: asset.id,
      tenant_id: asset.tenant_id,
      order_id: asset.order_id,
      sku_id: skuId,
      file_name: asset.file_name,
      file_size: asset.size,
      mime_type: asset.mime_type,
      storage_path: asset.storage_path ?? "",
      position: position++,
      created_at: asset.created_at,
      signed_url: !hasStorage && external ? external : `/api/assets/${asset.id}`,
      from_asset: true,
      artwork_fingerprint: fingerprint,
    });
  }

  return out;
}

/** Gallery rows first, then webhook/asset artwork for the same SKUs. */
export function mergeSkuImagesWithAssets(
  gallery: OrderSkuImageWithUrl[],
  assets: Asset[],
  opts?: { soleSkuId?: string | null }
): OrderSkuImageWithUrl[] {
  const fromAssets = skuImagesFromAssets(assets, opts);
  const merged = [
    ...gallery,
    ...fromAssets.filter((a) => !gallery.some((g) => g.id === a.id)),
  ];
  const seen = new Set<string>();
  const out: OrderSkuImageWithUrl[] = [];
  for (const img of merged) {
    const fp =
      img.artwork_fingerprint ||
      (img.storage_path?.trim() ? `sp:${img.storage_path.trim()}` : "") ||
      (img.signed_url && /^https?:\/\//i.test(img.signed_url)
        ? `url:${canonicalArtworkUrl(img.signed_url)}`
        : "") ||
      `id:${img.id}`;
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(img);
  }
  return out;
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
