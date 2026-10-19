import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { loadOrderFinalDriveContext } from "@/lib/order-gdrive";
import {
  checkFinalFolderPdfPrintSpec,
  PDF_CHECK_UNCHECKED,
} from "@/lib/gdrive-pdf-print-check";
import { cacheGet, cacheSet } from "@/lib/cache";

// Each card with a Final PDF re-ran this check (~2-3s: Drive folder listing)
// on every board load. Real results are remembered 2 minutes per order; a
// manual Drive refresh (gdrive-status?refresh=1) clears it. Unchecked/failed
// results are never cached.
const PDF_CHECK_TTL_SECONDS = 120;

/**
 * GET — inspect the newest Final-folder PDF for Acrobat layers + Fast Web View.
 * Downloads only the first 64KB. Failures return checked:false (no false alarm).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: orderId } = await params;
  const respKey = `wf:pdf-check-resp:v1:${ctx.tenant.id}:${orderId}`;
  const cached = await cacheGet<Record<string, unknown>>(respKey);
  if (cached) return NextResponse.json(cached);
  const supabase = await createClient();

  try {
    const loaded = await loadOrderFinalDriveContext(
      supabase,
      ctx.tenant.id,
      orderId
    );

    if (loaded.kind === "not_found") {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (loaded.kind === "not_configured") {
      return NextResponse.json(PDF_CHECK_UNCHECKED);
    }
    if (loaded.kind === "error") {
      console.error("[pdf-check]", loaded.message);
      return NextResponse.json(PDF_CHECK_UNCHECKED);
    }

    const finalIds = loaded.resolved?.finalIds ?? [];
    const fallbackDesigner =
      finalIds.length === 0 ? loaded.resolved?.designerId : null;
    const result = await checkFinalFolderPdfPrintSpec(
      loaded.settings,
      fallbackDesigner ? [fallbackDesigner] : finalIds,
      fallbackDesigner ? { directOnly: true } : undefined
    );
    if (result.checked) await cacheSet(respKey, result, PDF_CHECK_TTL_SECONDS);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[pdf-check]", err);
    return NextResponse.json(PDF_CHECK_UNCHECKED);
  }
}
