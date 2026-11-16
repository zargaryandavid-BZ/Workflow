import "server-only";

import type { Order } from "@/lib/types";
import type { SkuItem } from "@/lib/skus";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateApprovalLayerPreviewsForOrder } from "@/lib/approval-layer-previews";
import { ensurePrintProofJpeg } from "@/lib/flatten-print-proof";
import { ORDER_ASSETS_BUCKET } from "@/lib/order-assets";
import { loadFinalArtworkSummary } from "@/lib/final-artwork-sku-count";

export type ScanFinalArtworkPicture = {
  sku_id: string;
  sku_name: string;
  url: string;
  /** Quantity from product specifications (`specs.skus`), when this page is a spec SKU. */
  qty: number | null;
};

function specSkuQty(sku: SkuItem | undefined): number | null {
  const qty = sku?.qty;
  if (typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0) return null;
  return Math.floor(qty);
}

/**
 * Scan-station artwork comes exclusively from the Final Production PDF.
 * Each PDF page is one SKU, in page order.
 */
export async function loadScanFinalArtworkPictures(
  order: Pick<Order, "id" | "title" | "tenant_id" | "specs">,
  ticketSkus: SkuItem[]
): Promise<{ pictures: ScanFinalArtworkPicture[]; pageCount: number }> {
  try {
    // Normal scan path: use the previews already generated when the Final PDF
    // was sent/updated. This avoids a Drive lookup and rebuilding every page.
    const cached = await loadFinalArtworkSummary(order.id);
    const fromCache = () => ({
      pictures: cached.artworkUrls.map((url, index) => {
        const page = index + 1;
        const ticketSku = ticketSkus[index];
        return {
          sku_id: ticketSku?.id ?? `__pdf_page_${page}__`,
          sku_name: ticketSku?.name.trim() || `SKU ${page}`,
          url,
          qty: specSkuQty(ticketSku),
        };
      }),
      pageCount: cached.count ?? cached.artworkUrls.length,
    });
    const cachedUsable = !!cached.count && cached.artworkUrls.some(Boolean);
    // Use the saved pictures as they are only when EVERY page has one. A page without a picture used to be dropped
    // silently (only the recovery below can make it), so the scan screen showed fewer SKUs than the Final PDF has.
    if (cachedUsable && cached.artworkUrls.every(Boolean)) return fromCache();

    // Recovery: build the pictures from the Final PDF. If that fails, keep whatever saved pictures exist.
    let previews: Awaited<ReturnType<typeof generateApprovalLayerPreviewsForOrder>>;
    try {
      previews = await generateApprovalLayerPreviewsForOrder(order);
    } catch (error) {
      if (cachedUsable) return fromCache();
      throw error;
    }
    const ordered = Object.entries(previews).sort(
      ([, a], [, b]) => a.page - b.page
    );
    if (ordered.length === 0) return cachedUsable ? fromCache() : { pictures: [], pageCount: 0 };

    const admin = createAdminClient();
    const rows: {
      skuId: string;
      skuName: string;
      path: string;
      qty: number | null;
    }[] = [];

    for (const [previewSkuId, preview] of ordered) {
      const path = await ensurePrintProofJpeg(admin, preview);
      if (!path) continue;
      const ticketSku =
        ticketSkus.find((sku) => sku.id === previewSkuId) ??
        ticketSkus[preview.page - 1];
      rows.push({
        skuId: previewSkuId,
        skuName: ticketSku?.name.trim() || `SKU ${preview.page}`,
        path,
        qty: specSkuQty(ticketSku),
      });
    }

    if (rows.length === 0) {
      return cachedUsable ? fromCache() : { pictures: [], pageCount: ordered.length };
    }

    const { data: signed } = await admin.storage
      .from(ORDER_ASSETS_BUCKET)
      .createSignedUrls(
        rows.map((row) => row.path),
        3600
      );
    const urlByPath = new Map(
      (signed ?? [])
        .filter((row) => !row.error && row.signedUrl)
        .map((row) => [row.path, row.signedUrl])
    );

    // Build a url lookup by skuId so we can fill all pages, not just the ones
    // that produced a JPEG. Pages that failed ensurePrintProofJpeg get url=""
    // and show a placeholder thumbnail in the modal — but still appear as a SKU.
    const urlBySkuId = new Map(
      rows.map((row) => [row.skuId, urlByPath.get(row.path) ?? ""])
    );

    return {
      pictures: ordered.map(([previewSkuId, preview]) => {
        const ticketSku =
          ticketSkus.find((sku) => sku.id === previewSkuId) ??
          ticketSkus[preview.page - 1];
        return {
          sku_id: previewSkuId,
          sku_name: ticketSku?.name.trim() || `SKU ${preview.page}`,
          url: urlBySkuId.get(previewSkuId) ?? "",
          qty: specSkuQty(ticketSku),
        };
      }),
      pageCount: ordered.length,
    };
  } catch (error) {
    console.warn(
      "[fulfillment-scan] Final Production artwork unavailable:",
      error instanceof Error ? error.message : error
    );
    return { pictures: [], pageCount: 0 };
  }
}
