import { after, NextResponse } from "next/server";
import { pdfCheckRespKey } from "@/lib/board-cache-keys";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { loadOrderFinalDriveContext } from "@/lib/order-gdrive";
import {
  checkFinalFolderPdfPrintSpec,
  PDF_CHECK_UNCHECKED,
} from "@/lib/gdrive-pdf-print-check";
import { swrGet, swrSet } from "@/lib/cache";

// Each card with a Final PDF re-ran this check (~2-3s: Drive folder listing)
// on every board load. Real results are remembered 10 minutes per order; a
// manual Drive refresh (gdrive-status?refresh=1) clears it. Unchecked/failed
// results are never cached.
// 10 min (was 2): with 2 min almost every board visit re-listed Drive for
// every card (~1.5s each). Same window as the card-picture answer; a Drive
// refresh still clears it at once.
// Hayk 2026-11-26: answers are kept a day and shown at once; after 10 min the
// next board open re-checks Drive in the background (stale-while-revalidate).
const PDF_CHECK_FRESH_SECONDS = 10 * 60;


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
  const tenantId = ctx.tenant.id;
  const respKey = pdfCheckRespKey(tenantId, orderId);
  const supabase = await createClient();

  // Saved answer → show it now; if it's older than the fresh window, re-check
  // Drive in the background so the next open is up to date.
  const saved = await swrGet<Record<string, unknown>>(respKey);
  if (saved) {
    if (saved.ageSeconds > PDF_CHECK_FRESH_SECONDS) {
      try {
        after(() => computePdfCheck(supabase, tenantId, orderId).catch(() => undefined));
      } catch {
        // after() unavailable outside a request — skip the refresh
      }
    }
    return NextResponse.json(saved.value);
  }

  const res = await computePdfCheck(supabase, tenantId, orderId);
  return NextResponse.json(res.body, { status: res.status });
}

/** Run the Drive PDF check and save a real (checked) result. */
async function computePdfCheck(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  orderId: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    const loaded = await loadOrderFinalDriveContext(supabase, tenantId, orderId);

    if (loaded.kind === "not_found") {
      return { status: 404, body: { error: "Order not found" } };
    }
    if (loaded.kind === "not_configured") {
      return { status: 200, body: PDF_CHECK_UNCHECKED as Record<string, unknown> };
    }
    if (loaded.kind === "error") {
      console.error("[pdf-check]", loaded.message);
      return { status: 200, body: PDF_CHECK_UNCHECKED as Record<string, unknown> };
    }

    const finalIds = loaded.resolved?.finalIds ?? [];
    const fallbackDesigner =
      finalIds.length === 0 ? loaded.resolved?.designerId : null;
    const result = await checkFinalFolderPdfPrintSpec(
      loaded.settings,
      fallbackDesigner ? [fallbackDesigner] : finalIds,
      fallbackDesigner ? { directOnly: true } : undefined
    );
    if (result.checked) {
      await swrSet(pdfCheckRespKey(tenantId, orderId), result);
    }
    return { status: 200, body: result as unknown as Record<string, unknown> };
  } catch (err) {
    console.error("[pdf-check]", err);
    return { status: 200, body: PDF_CHECK_UNCHECKED as Record<string, unknown> };
  }
}
