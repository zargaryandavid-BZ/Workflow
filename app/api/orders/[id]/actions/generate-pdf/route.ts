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

export const runtime = "nodejs";
export const maxDuration = 180;

const BUCKET = "order-assets";

/**
 * Load the composite layer-preview signed URL for each SKU.
 * Returns a map of skuId → signed URL (180 s TTL — enough to embed in ticket).
 * Returns an empty map when no approval proof has been generated yet.
 */
async function loadCompositePreviewUrls(
  orderId: string,
  skus: { id: string }[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (skus.length === 0) return out;

  try {
    const { loadRespondCustomerProofForOrderId } = await import(
      "@/lib/approval-layer-previews"
    );
    const proof = await loadRespondCustomerProofForOrderId(orderId, skus as never);
    const previews = proof.layerPreviews as Record<
      string,
      { fileId: string; rev: string; page: number }
    >;
    if (Object.keys(previews).length === 0) return out;

    const { layerPreviewObjectPath } = await import(
      "@/lib/approval-layer-preview-paths"
    );

    const pathToSku = new Map<string, string>();
    for (const [skuId, p] of Object.entries(previews)) {
      pathToSku.set(
        layerPreviewObjectPath(p.fileId, p.rev, p.page, "composite"),
        skuId
      );
    }

    const admin = createAdminClient();
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
    console.error("[generate-pdf] composite preview load failed:", err);
  }

  return out;
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
    // --- Fast path: use composite layer-preview JPEGs from Supabase ---
    // These are the same artwork-only images already generated when the
    // approval proof was built. Fetching them avoids downloading the raw
    // Drive PDF and rasterizing it (which takes 40-120 s).
    const compositeUrls = await loadCompositePreviewUrls(
      orderId,
      exportData.skus
    );

    let skuRows: OrderExportSkuRow[];
    const finalPdfBuffers: Buffer[] = [];

    // Inject composite URLs when available; otherwise use the uploaded
    // artwork images already on each skuRow. Both paths are fast — we no
    // longer fall back to the slow Drive download + rasterization path.
    skuRows = exportData.skuRows.map((row) => {
      const compositeUrl = compositeUrls.get(row.id);
      if (compositeUrl) return { ...row, imageLinks: [compositeUrl] };
      return row;
    });
    // No finalPdfBuffers → generateJobTicketPdf uses the imageLinks path.

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
