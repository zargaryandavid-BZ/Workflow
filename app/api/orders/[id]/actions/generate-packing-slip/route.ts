import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  assertButtonVisibleForOrder,
  loadOrderExportData,
} from "@/lib/button-automation-order-data";
import { generatePackingSlipPdf, stampPackingSlipPdfArtwork } from "@/lib/packing-slip-pdf";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchStaffArtworkPack, downloadArtworkPdfBytesByFileId } from "@/lib/respond-final-pdf";
import type { OrderExportSkuRow } from "@/lib/button-automation-order-data";

export const runtime = "nodejs";

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
            ? "This button is not a Packing Slip action. Recreate it in Settings → Button Automation with action “Generate Packing Slip” (requires DB migration 0043)."
            : buttonError,
      },
      { status: 400 }
    );
  }

  let pdfBuffer: Buffer;
  try {
    const poNumber =
      typeof body.poNumber === "string" ? body.poNumber.trim() : "";

    let skuRows: OrderExportSkuRow[] = exportData.skuRows;
    let pdfArt: { skuId: string; fileId: string; page: number }[] = [];
    try {
      const pack = await fetchStaffArtworkPack(
        createAdminClient(),
        ctx.tenant.id,
        {
          id: exportData.order.id,
          title: exportData.order.title,
          specs: (exportData.order.specs ?? {}) as Record<string, unknown>,
        },
        exportData.skus
      );
      if (Object.keys(pack.bySku).length > 0) {
        skuRows = pack.skus.map((sku, index) => {
          const prev =
            exportData.skuRows.find((row) => row.id === sku.id) ??
            exportData.skuRows[index];
          return {
            id: sku.id,
            index: index + 1,
            name: sku.name.trim() || prev?.name || `SKU ${index + 1}`,
            qty: sku.qty ?? prev?.qty ?? null,
            imageLinks: prev?.imageLinks ?? [],
            imageFiles: prev?.imageFiles ?? [],
          };
        });
        pdfArt = pack.skus.flatMap((sku) => {
          const pdf = pack.bySku[sku.id];
          if (!pdf?.fileId || pdf.page == null) return [];
          return [{ skuId: sku.id, fileId: pdf.fileId, page: pdf.page }];
        });
      }
    } catch (err) {
      console.error("[generate-packing-slip] artwork pack", err);
    }

    const { buffer, artSlots } = await generatePackingSlipPdf(
      { ...exportData, skuRows },
      {
        part,
        totalParts,
        blind: Boolean(body.blind),
        poNumber: poNumber || undefined,
        pdfArt,
      }
    );

    const fileIds = [...new Set(artSlots.map((s) => s.fileId))];
    if (fileIds.length > 0) {
      try {
        const bytes = await downloadArtworkPdfBytesByFileId(
          createAdminClient(),
          ctx.tenant.id,
          fileIds
        );
        pdfBuffer = await stampPackingSlipPdfArtwork(buffer, artSlots, bytes);
      } catch (err) {
        console.error("[generate-packing-slip] stamp artwork", err);
        pdfBuffer = buffer;
      }
    } else {
      pdfBuffer = buffer;
    }
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
