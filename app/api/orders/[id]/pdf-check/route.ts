import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { loadOrderFinalDriveContext } from "@/lib/order-gdrive";
import {
  checkFinalFolderPdfPrintSpec,
  PDF_CHECK_UNCHECKED,
} from "@/lib/gdrive-pdf-print-check";

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
    const result = await checkFinalFolderPdfPrintSpec(
      loaded.settings,
      finalIds
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("[pdf-check]", err);
    return NextResponse.json(PDF_CHECK_UNCHECKED);
  }
}
