import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "order-assets";
const FETCH_USER_AGENT = "BazaarPrinting-WorkflowApp/1.0";

export function isExternalHttpUrl(url: string | null | undefined): boolean {
  const trimmed = url?.trim();
  return Boolean(
    trimmed &&
      (trimmed.startsWith("http://") || trimmed.startsWith("https://"))
  );
}

function extFromContentType(contentType: string, fileName: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("pdf")) return "pdf";
  if (ct.includes("svg")) return "svg";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";

  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext && /^[a-z0-9]{2,5}$/.test(ext)) return ext;
  return "jpg";
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_") || "artwork";
}

interface AssetRow {
  id: string;
  sku_key: string | null;
  external_url: string | null;
  storage_path: string | null;
  file_name: string;
}

export interface SaveExternalArtworkResult {
  saved: number;
  failed: number;
  results: {
    assetId: string;
    skuKey: string | null;
    status: "fulfilled" | "rejected";
    storagePath?: string;
    error?: string;
  }[];
}

export async function saveAllExternalArtwork(params: {
  admin: SupabaseClient;
  tenantId: string;
  orderId: string;
}): Promise<SaveExternalArtworkResult> {
  const { admin, tenantId, orderId } = params;

  const { data: assetRows, error } = await admin
    .from("assets")
    .select("id, sku_key, external_url, storage_path, file_name")
    .eq("tenant_id", tenantId)
    .eq("order_id", orderId);

  if (error) {
    throw new Error(error.message);
  }

  const targets = ((assetRows ?? []) as AssetRow[]).filter(
    (asset) =>
      isExternalHttpUrl(asset.external_url) &&
      !asset.storage_path?.trim()
  );

  if (targets.length === 0) {
    return { saved: 0, failed: 0, results: [] };
  }

  const results = await Promise.allSettled(
    targets.map(async (asset) => {
      const externalUrl = asset.external_url!.trim();
      const res = await fetch(externalUrl, {
        headers: { "User-Agent": FETCH_USER_AGENT },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching ${externalUrl}`);
      }

      const contentType = res.headers.get("content-type") ?? "image/jpeg";
      const buffer = Buffer.from(await res.arrayBuffer());
      const ext = extFromContentType(contentType, asset.file_name);
      const folder = asset.sku_key
        ? `sku-${asset.sku_key}`
        : "order-artwork";
      const storagePath = `${tenantId}/${orderId}/${folder}/${Date.now()}-${safeFileName(asset.file_name)}.${ext}`;

      const { error: uploadError } = await admin.storage
        .from(BUCKET)
        .upload(storagePath, buffer, {
          contentType: contentType.split(";")[0]?.trim() || contentType,
          upsert: false,
        });

      if (uploadError) {
        throw new Error(`Upload failed: ${uploadError.message}`);
      }

      const { error: updateError } = await admin
        .from("assets")
        .update({
          storage_path: storagePath,
          external_url: null,
          mime_type: contentType.split(";")[0]?.trim() || null,
          size: buffer.byteLength,
        })
        .eq("id", asset.id)
        .eq("tenant_id", tenantId);

      if (updateError) {
        await admin.storage.from(BUCKET).remove([storagePath]);
        throw new Error(`Asset update failed: ${updateError.message}`);
      }

      return { assetId: asset.id, skuKey: asset.sku_key, storagePath };
    })
  );

  const mapped = results.map((result, index) => {
    const asset = targets[index];
    if (result.status === "fulfilled") {
      return {
        assetId: asset.id,
        skuKey: asset.sku_key,
        status: "fulfilled" as const,
        storagePath: result.value.storagePath,
      };
    }
    const reason = result.reason;
    return {
      assetId: asset.id,
      skuKey: asset.sku_key,
      status: "rejected" as const,
      error: reason instanceof Error ? reason.message : String(reason),
    };
  });

  return {
    saved: mapped.filter((r) => r.status === "fulfilled").length,
    failed: mapped.filter((r) => r.status === "rejected").length,
    results: mapped,
  };
}
