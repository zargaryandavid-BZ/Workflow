import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Order } from "@/lib/types";
import type { SkuItem } from "@/lib/skus";
import {
  layerPicsForJobTicket,
  layerPreviewObjectPath,
  type RespondLayerPreview,
} from "@/lib/approval-layer-preview-paths";
import { ORDER_ASSETS_BUCKET, ORDER_ASSET_SIGNED_URL_TTL_SEC } from "@/lib/order-assets";

/**
 * Per-SKU artwork for /api/export/order-card (Pulse): the stored pictures of
 * each SKU's page of the Final Production PDF — page 1 = SKU 1, page 2 = SKU 2,
 * the same rule the job ticket and /respond use. Without this a multi-SKU card
 * only carried the kanban card picture (a Drive thumbnail of page 1), which
 * landed on SKU 1 and left every other SKU empty.
 *
 * Only reads pictures already rendered; returns an empty map when there are
 * none yet (`missing: true`) so the caller can render them in the background.
 */
export async function loadSkuPageImageLinks(
  admin: SupabaseClient,
  order: Pick<Order, "id" | "title" | "tenant_id" | "specs">,
  skus: SkuItem[]
): Promise<{ links: Map<string, string[]>; missing: boolean }> {
  const links = new Map<string, string[]>();
  if (skus.length === 0) return { links, missing: false };

  const { loadRespondCustomerProof } = await import("@/lib/approval-layer-previews");
  const proof = await loadRespondCustomerProof(
    order,
    skus.map((s) => ({ id: s.id, name: s.name, qty: s.qty }))
  );
  const previews = proof.layerPreviews as Record<string, RespondLayerPreview>;
  const list = Object.values(previews);
  if (list.length === 0) return { links, missing: true };

  const pathsBySku = new Map<string, string[]>();
  skus.forEach((sku, i) => {
    // Same fallback as the job ticket: by SKU id, else by position.
    const preview = previews[sku.id] ?? list[i];
    if (!preview) return;
    const paths = layerPicsForJobTicket(preview).map((pic) =>
      layerPreviewObjectPath(preview.fileId, preview.rev, preview.page, pic.layer)
    );
    if (paths.length > 0) pathsBySku.set(sku.id, paths);
  });

  const allPaths = [...new Set([...pathsBySku.values()].flat())];
  if (allPaths.length === 0) return { links, missing: true };
  const { data } = await admin.storage
    .from(ORDER_ASSETS_BUCKET)
    .createSignedUrls(allPaths, ORDER_ASSET_SIGNED_URL_TTL_SEC);
  const urlByPath = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.path && row.signedUrl && !row.error) urlByPath.set(row.path, row.signedUrl);
  }
  for (const [skuId, paths] of pathsBySku) {
    const urls = paths.map((p) => urlByPath.get(p)).filter((u): u is string => !!u);
    if (urls.length > 0) links.set(skuId, urls);
  }
  return { links, missing: links.size === 0 };
}
