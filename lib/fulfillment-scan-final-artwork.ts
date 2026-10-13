import "server-only";

import type { Order } from "@/lib/types";
import type { SkuItem } from "@/lib/skus";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateApprovalLayerPreviewsForOrder } from "@/lib/approval-layer-previews";
import { ensurePrintProofJpeg } from "@/lib/flatten-print-proof";
import { ORDER_ASSETS_BUCKET } from "@/lib/order-assets";

export type ScanFinalArtworkPicture = {
  sku_id: string;
  sku_name: string;
  url: string;
};

/**
 * Scan-station artwork comes exclusively from the Final Production PDF.
 * Each PDF page is one SKU, in page order.
 */
export async function loadScanFinalArtworkPictures(
  order: Pick<Order, "id" | "title" | "tenant_id" | "specs">,
  ticketSkus: SkuItem[]
): Promise<{ pictures: ScanFinalArtworkPicture[]; pageCount: number }> {
  try {
    const previews = await generateApprovalLayerPreviewsForOrder(order);
    const ordered = Object.entries(previews).sort(
      ([, a], [, b]) => a.page - b.page
    );
    if (ordered.length === 0) return { pictures: [], pageCount: 0 };

    const admin = createAdminClient();
    const rows: {
      skuId: string;
      skuName: string;
      path: string;
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
      });
    }

    if (rows.length === 0) {
      return { pictures: [], pageCount: ordered.length };
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

    return {
      pictures: rows.flatMap((row) => {
        const url = urlByPath.get(row.path);
        return url
          ? [{ sku_id: row.skuId, sku_name: row.skuName, url }]
          : [];
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
