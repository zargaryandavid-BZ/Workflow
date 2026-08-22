import type { SupabaseClient } from "@supabase/supabase-js";
import { parseBazaarPortalInboundKeys } from "@/lib/bazaar-portal-keys";
import { canonicalizeWebhookSourceKey } from "@/lib/webhook-source-styles";

const BUCKET = "order-assets";
const FETCH_USER_AGENT = "BazaarPrinting-WorkflowApp/1.0";

export function isExternalHttpUrl(url: string | null | undefined): boolean {
  const trimmed = url?.trim();
  return Boolean(
    trimmed &&
      (trimmed.startsWith("http://") || trimmed.startsWith("https://"))
  );
}

/** Bazaar Order Sync artwork download — requires partner osk_ header. */
export function isBazaarPortalArtworkUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /\/api\/v1\/production\/files\/\d+\/?$/.test(u.pathname);
  } catch {
    return false;
  }
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

async function resolvePortalOskForOrder(
  admin: SupabaseClient,
  tenantId: string,
  orderId: string
): Promise<string | null> {
  const { data: order } = await admin
    .from("orders")
    .select("specs, webhook_source")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const source = canonicalizeWebhookSourceKey(
    (order as { webhook_source?: string | null } | null)?.webhook_source
  );
  const specs = ((order as { specs?: Record<string, unknown> } | null)?.specs ??
    {}) as Record<string, unknown>;
  const brokerId =
    typeof specs.bazaar_broker_id === "string"
      ? specs.bazaar_broker_id.trim()
      : "";
  if (source !== "portal" && !brokerId) return null;
  if (!brokerId) return null;

  const { data: cfg } = await admin
    .from("webhook_configs")
    .select("bazaar_portal_inbound_keys")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const { keys } = parseBazaarPortalInboundKeys(
    (cfg as { bazaar_portal_inbound_keys?: unknown } | null)
      ?.bazaar_portal_inbound_keys
  );
  return keys[brokerId] ?? null;
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

  const portalOsk = targets.some((a) =>
    isBazaarPortalArtworkUrl(a.external_url!.trim())
  )
    ? await resolvePortalOskForOrder(admin, tenantId, orderId)
    : null;

  const results = await Promise.allSettled(
    targets.map(async (asset) => {
      const externalUrl = asset.external_url!.trim();
      const headers: Record<string, string> = {
        "User-Agent": FETCH_USER_AGENT,
      };
      if (isBazaarPortalArtworkUrl(externalUrl)) {
        if (!portalOsk) {
          throw new Error(
            "Missing osk_ for portal artwork — add Partner keys in Workflow Integrations"
          );
        }
        headers["x-webhook-secret"] = portalOsk;
      }

      const res = await fetch(externalUrl, { headers });
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
          // Keep external_url so portal re-fire can idempotently skip re-insert.
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
    const asset = targets[index]!;
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
