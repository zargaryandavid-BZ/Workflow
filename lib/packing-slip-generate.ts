import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadOrderExportData,
  type OrderExportData,
  type OrderExportSkuRow,
} from "@/lib/button-automation-order-data";
import { generatePackingSlipPdf } from "@/lib/packing-slip-pdf";
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "order-assets";

export function packingSlipPartFromOrderNumber(orderNumber: string): number {
  const m = String(orderNumber).trim().match(/-(\d+)\s*$/);
  if (!m) return 1;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * Stacked print JPEG (Artwork + foil / Spot UV) for the packing slip.
 */
export async function loadPackingSlipCompositePreviewUrls(
  orderId: string,
  skus: { id: string }[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
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
    const previews = proof.layerPreviews as Record<
      string,
      {
        fileId: string;
        rev: string;
        page: number;
        layers: { id: string; name: string }[];
      }
    >;
    if (Object.keys(previews).length === 0) return out;

    const admin = createAdminClient();
    const pathToSku = new Map<string, string>();
    for (const [skuId, p] of Object.entries(previews)) {
      const path = await ensurePrintProofJpeg(admin, p);
      if (path) pathToSku.set(path, skuId);
    }
    if (pathToSku.size === 0) return out;

    const { data: signed } = await admin.storage
      .from(BUCKET)
      .createSignedUrls([...pathToSku.keys()], 180);

    for (const row of signed ?? []) {
      if (row.path && row.signedUrl && !row.error) {
        const skuId = pathToSku.get(row.path);
        if (skuId) out.set(skuId, row.signedUrl);
      }
    }
  } catch (err) {
    console.error("[generate-packing-slip] composite preview load", err);
  }

  return out;
}

export async function generatePackingSlipPdfFromExport(
  exportData: OrderExportData,
  opts: {
    part: number;
    totalParts: number;
    blind?: boolean;
    poNumber?: string;
  }
): Promise<{ buffer: Buffer }> {
  const compositeUrls = await loadPackingSlipCompositePreviewUrls(
    exportData.order.id,
    exportData.skus
  );

  const skuRows: OrderExportSkuRow[] = exportData.skuRows.map((row) => {
    const compositeUrl = compositeUrls.get(row.id);
    if (compositeUrl) {
      return { ...row, imageLinks: [compositeUrl] };
    }
    return row;
  });

  const { buffer } = await generatePackingSlipPdf(
    { ...exportData, skuRows },
    {
      part: opts.part,
      totalParts: opts.totalParts,
      blind: Boolean(opts.blind),
      poNumber: opts.poNumber,
    }
  );
  return { buffer };
}

export async function generatePackingSlipPdfBuffer(
  supabase: SupabaseClient,
  orderId: string,
  tenantId: string,
  tenantName: string
): Promise<
  { buffer: Buffer; orderNumber: string; part: number; totalParts: number } | {
    error: string;
    status: number;
  }
> {
  let exportData: OrderExportData | null;
  try {
    exportData = await loadOrderExportData(
      supabase,
      orderId,
      tenantId,
      tenantName
    );
  } catch (err) {
    console.error("[generate-packing-slip] loadOrderExportData", err);
    return { error: "Failed to load order data for packing slip", status: 500 };
  }
  if (!exportData) {
    return { error: "Order not found", status: 404 };
  }

  const groupSize =
    exportData.groupSize != null && exportData.groupSize >= 1
      ? exportData.groupSize
      : 1;
  const part = Math.min(
    packingSlipPartFromOrderNumber(exportData.orderNumber),
    groupSize
  );
  const totalParts = groupSize;

  try {
    const { buffer } = await generatePackingSlipPdfFromExport(exportData, {
      part,
      totalParts,
    });
    if (!buffer?.length) {
      return { error: "Packing slip PDF was empty", status: 500 };
    }
    return { buffer, orderNumber: exportData.orderNumber, part, totalParts };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate packing slip";
    console.error("[generate-packing-slip]", err);
    return { error: message, status: 500 };
  }
}
