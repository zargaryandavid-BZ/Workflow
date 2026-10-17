import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  assertButtonVisibleForOrder,
  loadOrderExportData,
} from "@/lib/button-automation-order-data";
import { generatePackingSlipPdfFromExport } from "@/lib/packing-slip-generate";

export const runtime = "nodejs";
// Long enough for layer-preview fetches + PDF generation.
export const maxDuration = 120;

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
    /** Only include these SKU IDs in the packing slip (null = all). */
    selectedSkuIds?: string[] | null;
    /** Per-SKU quantity overrides (keyed by sku_id). */
    copyQties?: Record<string, number>;
    /** Print layout: multiple SKUs per page or one SKU per page. */
    layout?: "multiple" | "one_per_slip";
    /** Total number of boxes — printed in the BOX section of the slip. */
    boxCount?: number | null;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
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

  // Board automations pass button_id. Scan / fulfillment may generate without one
  // (any signed-in tenant member who can load the order).
  if (body.button_id) {
    const { error: buttonError } = await assertButtonVisibleForOrder(
      supabase,
      body.button_id,
      ctx.tenant.id,
      exportData.order.column_id,
      ["generate_packing_slip", "print_packing_slip"]
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
  }

  let pdfBuffer: Buffer;
  try {
    const poNumber =
      typeof body.poNumber === "string" ? body.poNumber.trim() : "";

    const { buffer } = await generatePackingSlipPdfFromExport(exportData, {
      part,
      totalParts,
      blind: Boolean(body.blind),
      poNumber: poNumber || undefined,
      selectedSkuIds: Array.isArray(body.selectedSkuIds) ? body.selectedSkuIds : undefined,
      copyQties: body.copyQties && typeof body.copyQties === "object" ? body.copyQties : undefined,
      layout: body.layout === "one_per_slip" ? "one_per_slip" : "multiple",
      boxCount: typeof body.boxCount === "number" && body.boxCount > 0 ? Math.floor(body.boxCount) : undefined,
    });
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
