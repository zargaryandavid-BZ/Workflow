import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantContext } from "@/lib/auth";
import {
  assertButtonVisibleForOrder,
  loadOrderExportData,
} from "@/lib/button-automation-order-data";
import { generateJobTicketPdf } from "@/lib/button-automation-pdf";
import { downloadUniqueFinalPdfBuffers } from "@/lib/respond-final-pdf";

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
    const finalPdfBuffers = await downloadUniqueFinalPdfBuffers(
      createAdminClient(),
      ctx.tenant.id,
      {
        id: exportData.order.id,
        title: exportData.order.title,
        specs: (exportData.order.specs ?? {}) as Record<string, unknown>,
      },
      exportData.skus
    );
    pdfBuffer = await generateJobTicketPdf(exportData, { finalPdfBuffers });
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
