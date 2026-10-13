import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadOrderExportData,
  type OrderExportSkuRow,
} from "@/lib/button-automation-order-data";
import { generateJobTicketPdf } from "@/lib/button-automation-pdf";
import {
  layerPicsForJobTicket,
  layerPreviewObjectPath,
  type RespondLayerPreview,
} from "@/lib/approval-layer-preview-paths";
import { ORDER_ASSETS_BUCKET } from "@/lib/order-assets";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-plate PNG bytes for each SKU (job-ticket 2-up grid).
 * Downloads from storage so we never fall back to the green Drive thumb.
 */
async function loadLayerPreviewImages(
  orderId: string,
  skus: { id: string }[]
): Promise<Map<string, { name: string; buffer: Buffer }[]>> {
  const out = new Map<string, { name: string; buffer: Buffer }[]>();
  if (skus.length === 0) return out;

  try {
    const { loadRespondCustomerProofForOrderId } = await import(
      "@/lib/approval-layer-previews"
    );
    const { generateApprovalLayerPreviewsForOrder } = await import(
      "@/lib/approval-layer-previews"
    );
    const adminForGen = createAdminClient();
    const { data: order } = await adminForGen
      .from("orders")
      .select("id, title, tenant_id, specs")
      .eq("id", orderId)
      .maybeSingle();
    if (order?.tenant_id) {
      await generateApprovalLayerPreviewsForOrder({
        id: order.id as string,
        title: String(order.title ?? ""),
        tenant_id: order.tenant_id as string,
        specs: (order.specs ?? {}) as never,
      }).catch((err) =>
        console.warn(
          "[job-ticket] generate layer previews failed:",
          err instanceof Error ? err.message : err
        )
      );
    }
    const proof = await loadRespondCustomerProofForOrderId(
      orderId,
      skus as never
    );
    const previews = proof.layerPreviews as Record<string, RespondLayerPreview>;
    if (Object.keys(previews).length === 0) return out;

    const admin = createAdminClient();
    const previewList = Object.entries(previews);

    const downloadPic = async (
      preview: RespondLayerPreview,
      pic: { layer: string; name: string }
    ): Promise<{ name: string; buffer: Buffer } | null> => {
      const path = layerPreviewObjectPath(
        preview.fileId,
        preview.rev,
        preview.page,
        pic.layer
      );
      const { data, error } = await admin.storage
        .from(ORDER_ASSETS_BUCKET)
        .download(path);
      if (error || !data) return null;
      const buffer = Buffer.from(await data.arrayBuffer());
      if (buffer.length === 0) return null;
      return { name: pic.name, buffer };
    };

    for (let i = 0; i < skus.length; i++) {
      const sku = skus[i]!;
      const preview =
        previews[sku.id] ??
        previewList[i]?.[1] ??
        (previewList.length === 1 ? previewList[0]![1] : undefined);
      if (!preview) continue;
      const pics = layerPicsForJobTicket(preview);
      const buffers: { name: string; buffer: Buffer }[] = [];
      for (let n = 0; n < pics.length; n++) {
        const pic = pics[n]!;
        const loaded = await downloadPic(preview, pic);
        if (loaded) {
          buffers.push({
            name: loaded.name || `Layer ${n + 1}`,
            buffer: loaded.buffer,
          });
        }
      }
      if (buffers.length > 0) out.set(sku.id, buffers);
    }
    return out;
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
          imageFiles: [],
          imageLinks: [],
          imageBuffers: layers,
        };
      }
      return { ...row, imageFiles: [], imageLinks: [], imageBuffers: [] };
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
