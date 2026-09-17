import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantContext } from "@/lib/auth";
import {
  assertButtonVisibleForOrder,
  loadOrderExportData,
  type OrderExportSkuRow,
} from "@/lib/button-automation-order-data";
import { generateJobTicketPdf } from "@/lib/button-automation-pdf";
import {
  layerPicsForJobTicket,
  layerPreviewObjectPath,
  type RespondLayerPreview,
} from "@/lib/approval-layer-preview-paths";

export const runtime = "nodejs";
export const maxDuration = 180;

const BUCKET = "order-assets";

/**
 * Signed URLs for the same named-layer pictures the customer sees on /respond.
 * One list per SKU — the ticket draws them 2×2 on a single page.
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
    const proof = await loadRespondCustomerProofForOrderId(orderId, skus as never);
    const previews = proof.layerPreviews as Record<string, RespondLayerPreview>;
    if (Object.keys(previews).length === 0) return out;

    const pathToSlot: Array<{ path: string; skuId: string; name: string }> = [];
    for (const [skuId, p] of Object.entries(previews)) {
      const pics = layerPicsForJobTicket(p);
      for (const pic of pics) {
        pathToSlot.push({
          path: layerPreviewObjectPath(p.fileId, p.rev, p.page, pic.layer),
          skuId,
          name: pic.name,
        });
      }
    }
    if (pathToSlot.length === 0) return out;

    const admin = createAdminClient();
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
    console.error("[generate-pdf] layer preview load failed:", err);
    return out;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    button_id?: string;
  };
  if (!body.button_id) {
    return NextResponse.json({ error: "button_id required" }, { status: 422 });
  }

  const supabase = await createClient();
  const exportData = await loadOrderExportData(
    supabase,
    orderId,
    ctx.tenant.id,
    ctx.tenant.name
  );
  if (!exportData) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const { error: buttonError } = await assertButtonVisibleForOrder(
    supabase,
    body.button_id,
    ctx.tenant.id,
    exportData.order.column_id,
    "generate_pdf"
  );
  if (buttonError) {
    return NextResponse.json({ error: buttonError }, { status: 400 });
  }

  let pdfBuffer: Buffer;
  try {
    const layerImages = await loadLayerPreviewImages(orderId, exportData.skus);

    let skuRows: OrderExportSkuRow[];
    const finalPdfBuffers: Buffer[] = [];

    skuRows = exportData.skuRows.map((row) => {
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

    pdfBuffer = await generateJobTicketPdf(
      { ...exportData, skuRows },
      { finalPdfBuffers }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate PDF";
    console.error("[generate-pdf]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const safeName = exportData.orderNumber.replace(/[^a-zA-Z0-9._-]/g, "_");

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="job-ticket-${safeName}.pdf"`,
    },
  });
}
