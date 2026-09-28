import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { loadOrderFinalDriveContext } from "@/lib/order-gdrive";
import {
  checkFinalFolderPdfPrintSpec,
  PDF_CHECK_UNCHECKED,
} from "@/lib/gdrive-pdf-print-check";
import {
  getSharedDriveCache,
  setSharedDriveCache,
  invalidateSharedDriveCache,
} from "@/lib/drive-status-cache";

// This route previously had NO caching at all — every card, on every board
// load, downloaded and parsed a PDF straight from Drive. Same shared cache as
// gdrive-status (see lib/drive-status-cache.ts), 5-minute TTL.
const PDF_CHECK_TTL_MS = 5 * 60 * 1000;

/** Call this when an order's Final PDF changes, alongside invalidateDriveStatusCache. */
export function invalidatePdfCheckCache(tenantId: string, orderId: string) {
  invalidateSharedDriveCache(`${tenantId}:${orderId}:pdf-check`);
}

/**
 * GET — inspect the newest Final-folder PDF for Acrobat layers + Fast Web View.
 * Downloads only the first 64KB. Failures return checked:false (no false alarm).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: orderId } = await params;
  const bust = new URL(request.url).searchParams.get("refresh") === "1";
  const cacheKey = `${ctx.tenant.id}:${orderId}:pdf-check`;
  if (bust) invalidateSharedDriveCache(cacheKey);
  const cached = await getSharedDriveCache<Record<string, unknown>>(cacheKey);
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
    // Write-behind — don't make this already-slow (fresh Drive/PDF fetch)
    // request also wait on a cache-table write; next reader gets the hit.
    after(() => {
      void setSharedDriveCache(cacheKey, result, PDF_CHECK_TTL_MS);
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[pdf-check]", err);
    return NextResponse.json(PDF_CHECK_UNCHECKED);
  }
}
