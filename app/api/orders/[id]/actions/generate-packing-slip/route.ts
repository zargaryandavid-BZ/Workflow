import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantContext } from "@/lib/auth";
import {
  assertButtonVisibleForOrder,
  loadOrderExportData,
} from "@/lib/button-automation-order-data";
import { generatePackingSlipPdf } from "@/lib/packing-slip-pdf";
import type { OrderExportSkuRow } from "@/lib/button-automation-order-data";

export const runtime = "nodejs";
// Long enough for layer-preview fetches + PDF generation.
export const maxDuration = 120;

const BUCKET = "order-assets";

function parsePositiveInt(value: unknown, fallback: number): number {
  const n =
    typeof value === "string"
      ? Number.parseInt(value, 10)
      : typeof value === "number"
        ? value
        : NaN;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

/**
 * Load the composite layer-preview signed URL for each SKU so the packing slip
 * shows a clean artwork-only JPEG instead of the raw production PDF (which
 * includes dielines, cut marks, registration marks, etc.).
 *
 * Returns a map of skuId → signed URL. Missing entries mean no preview exists
 * and the slip should fall back to the existing uploaded image.
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

    // Build path → skuId map so we can look up results by path.
    const pathToSku = new Map<string, string>();
    for (const [skuId, p] of Object.entries(previews)) {
      pathToSku.set(
        layerPreviewObjectPath(p.fileId, p.rev, p.page, "composite"),
        skuId
      );
    }

    const admin = createAdminClient();
    // One storage round-trip for all composite paths.
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  let body: {
    button_id?: string;
    part?: number;
    totalParts?: number;
    blind?: boolean;
    poNumber?: string;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (!body.button_id) {
    return NextResponse.json({ error: "button_id required" }, { status: 422 });
  }

  const part = parsePositiveInt(
    body.part ?? url.searchParams.get("part"),
    1
  );
  const totalParts = parsePositiveInt(
    body.totalParts ?? url.searchParams.get("totalParts"),
    Math.max(part, 1)
  );

  if (part > totalParts) {
    return NextResponse.json(
      { error: "part cannot be greater than totalParts" },
      { status: 422 }
    );
  }

  const supabase = await createClient();
  let exportData;
  try {
    exportData = await loadOrderExportData(
      supabase,
      orderId,
      ctx.tenant.id,
      ctx.tenant.name
    );
  } catch (err) {
    console.error("[generate-packing-slip] loadOrderExportData", err);
    return NextResponse.json(
      { error: "Failed to load order data for packing slip" },
      { status: 500 }
    );
  }
  if (!exportData) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const { error: buttonError } = await assertButtonVisibleForOrder(
    supabase,
    body.button_id,
    ctx.tenant.id,
    exportData.order.column_id,
    "generate_packing_slip"
  );
  if (buttonError) {
    return NextResponse.json(
      {
        error:
          buttonError === "Invalid button action"
            ? "This button is not a Packing Slip action. Recreate it in Settings → Button Automation with action \"Generate Packing Slip\" (requires DB migration 0043)."
            : buttonError,
      },
      { status: 400 }
    );
  }

  let pdfBuffer: Buffer;
  try {
    const poNumber =
      typeof body.poNumber === "string" ? body.poNumber.trim() : "";

    // --- Artwork images ---
    // Prefer the composite layer-preview JPEG (artwork-only, no dielines/cut marks).
    // Falls back to the original uploaded image when no proof exists yet.
    const compositeUrls = await loadCompositePreviewUrls(
      orderId,
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
        part,
        totalParts,
        blind: Boolean(body.blind),
        poNumber: poNumber || undefined,
        // No pdfArt — we use JPEG composites, not embedded PDF pages.
      }
    );
    pdfBuffer = buffer;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate packing slip";
    console.error("[generate-packing-slip]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!pdfBuffer?.length) {
    return NextResponse.json(
      { error: "Packing slip PDF was empty" },
      { status: 500 }
    );
  }

  const safeName = exportData.orderNumber.replace(/[^a-zA-Z0-9._-]/g, "_");

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="packing-slip-${safeName}-${part}of${totalParts}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
