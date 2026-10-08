import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadOrderExportData,
  type OrderExportSkuRow,
} from "@/lib/button-automation-order-data";
import { generateJobTicketPdf } from "@/lib/button-automation-pdf";
import {
  layerPicsForJobTicket,
  type RespondLayerPreview,
} from "@/lib/approval-layer-preview-paths";
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "order-assets";

/**
 * Signed URL for the stacked print picture (Artwork + finishes) used on the
 * job ticket. Isolated white / cut plates are omitted.
 */
async function loadLayerPreviewImages(
  orderId: string,
  skus: { id: string }[]
): Promise<Map<string, { name: string; url: string }[]>> {
  const out = new Map<string, { name: string; url: string }[]>();
  if (skus.length === 0) return out;

  try {
    const { loadRespondCustomerProofForOrderId } = await import(
      "@/lib/approval-layer-previews"
    );
    const { ensurePrintProofJpeg } = await import("@/lib/flatten-print-proof");
    const proof = await loadRespondCustomerProofForOrderId(
      orderId,
      skus as never
    );
    const previews = proof.layerPreviews as Record<string, RespondLayerPreview>;
    if (Object.keys(previews).length === 0) return out;

    const admin = createAdminClient();
    const pathToSlot: Array<{ path: string; skuId: string; name: string }> = [];
    for (const [skuId, p] of Object.entries(previews)) {
      const path = await ensurePrintProofJpeg(admin, p);
      const pics = layerPicsForJobTicket(p);
      if (path) {
        pathToSlot.push({
          path,
          skuId,
          name: pics[0]?.name ?? "Artwork",
        });
      }
    }
    if (pathToSlot.length === 0) return out;

    const { data: signed } = await admin.storage
      .from(BUCKET)
      .createSignedUrls(
        pathToSlot.map((s) => s.path),
        180
      );

    const byPath = new Map((signed ?? []).map((row) => [row.path, row]));
    const bySku = new Map<string, { name: string; url: string }[]>();
    for (const slot of pathToSlot) {
      const row = byPath.get(slot.path);
      if (!row?.signedUrl || row.error) continue;
      const list = bySku.get(slot.skuId) ?? [];
      list.push({ name: slot.name, url: row.signedUrl });
      bySku.set(slot.skuId, list);
    }
    return bySku;
  } catch (err) {
    console.error("[job-ticket] layer preview load failed:", err);
    return out;
  }
}

export async function generateJobTicketPdfBuffer(
  supabase: SupabaseClient,
  orderId: string,
  tenantId: string,
  tenantName: string
): Promise<{ buffer: Buffer; orderNumber: string } | { error: string; status: number }> {
  const exportData = await loadOrderExportData(
    supabase,
    orderId,
    tenantId,
    tenantName
  );
  if (!exportData) {
    return { error: "Order not found", status: 404 };
  }

  try {
    const layerImages = await loadLayerPreviewImages(orderId, exportData.skus);
    const skuRows: OrderExportSkuRow[] = exportData.skuRows.map((row) => {
      const layers = layerImages.get(row.id);
      if (layers && layers.length > 0) {
        return {
          ...row,
          imageFiles: layers,
          imageLinks: layers.map((l) => l.url),
        };
      }
      return row;
    });

    const buffer = await generateJobTicketPdf(
      { ...exportData, skuRows },
      { finalPdfBuffers: [] }
    );
    return { buffer, orderNumber: exportData.orderNumber };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate PDF";
    console.error("[job-ticket]", err);
    return { error: message, status: 500 };
  }
}
