import type { SupabaseClient } from "@supabase/supabase-js";
import type { Asset } from "@/lib/types";

export const ORDER_ASSETS_BUCKET = "order-assets";
/** Signed URL lifetime for order asset downloads (48 hours). */
export const ORDER_ASSET_SIGNED_URL_TTL_SEC = 60 * 60 * 48;

export type OrderAssetRow = Asset & { signed_url?: string | null };

/** General order attachments — not SKU artwork or customer notification uploads. */
export function isOrderLevelAsset(
  asset: Pick<Asset, "sku_key" | "notification_id">
): boolean {
  return !asset.sku_key && !asset.notification_id;
}

export function safeAssetFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function orderAssetStoragePath(
  tenantId: string,
  orderId: string,
  fileName: string
): string {
  return `${tenantId}/${orderId}/assets/${Date.now()}-${safeAssetFileName(fileName)}`;
}

export function skuAssetStoragePath(
  tenantId: string,
  orderId: string,
  skuKey: string,
  fileName: string
): string {
  return `${tenantId}/${orderId}/sku-${skuKey}/${Date.now()}-${safeAssetFileName(fileName)}`;
}

export async function listOrderLevelAssets(
  supabase: SupabaseClient,
  orderId: string
): Promise<Asset[]> {
  const { data, error } = await supabase
    .from("assets")
    .select("*")
    .eq("order_id", orderId)
    .is("sku_key", null)
    .is("notification_id", null)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Asset[];
}

export async function attachSignedUrls(
  supabase: SupabaseClient,
  assets: Asset[]
): Promise<OrderAssetRow[]> {
  return Promise.all(
    assets.map(async (asset) => {
      if (!asset.storage_path) {
        return { ...asset, signed_url: asset.external_url ?? null };
      }
      const { data: signed } = await supabase.storage
        .from(ORDER_ASSETS_BUCKET)
        .createSignedUrl(asset.storage_path, ORDER_ASSET_SIGNED_URL_TTL_SEC, {
          download: asset.file_name,
        });
      return { ...asset, signed_url: signed?.signedUrl ?? null };
    })
  );
}

export async function uploadOrderLevelAsset(
  supabase: SupabaseClient,
  opts: {
    tenantId: string;
    userId: string;
    orderId: string;
    file: File;
  }
): Promise<Asset> {
  const { tenantId, userId, orderId, file } = opts;
  const path = orderAssetStoragePath(tenantId, orderId, file.name);

  const { error: uploadError } = await supabase.storage
    .from(ORDER_ASSETS_BUCKET)
    .upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { data: asset, error } = await supabase
    .from("assets")
    .insert({
      tenant_id: tenantId,
      order_id: orderId,
      sku_key: null,
      file_name: file.name,
      storage_path: path,
      mime_type: file.type || null,
      size: file.size,
      uploaded_by: userId,
    })
    .select("*")
    .single();

  if (error) {
    await supabase.storage.from(ORDER_ASSETS_BUCKET).remove([path]);
    throw new Error(error.message);
  }

  return asset as Asset;
}

export function formatAssetFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
