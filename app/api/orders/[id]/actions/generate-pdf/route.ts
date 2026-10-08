import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { assertButtonVisibleForOrder } from "@/lib/button-automation-order-data";
import { generateJobTicketPdfBuffer } from "@/lib/job-ticket-generate";

export const runtime = "nodejs";
export const maxDuration = 180;

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
  const { data: orderRow, error: orderError } = await supabase
    .from("orders")
    .select("column_id")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (orderError || !orderRow) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const { error: buttonError } = await assertButtonVisibleForOrder(
    supabase,
    body.button_id,
    ctx.tenant.id,
    orderRow.column_id as string,
    "generate_pdf"
  );
  if (buttonError) {
    return NextResponse.json({ error: buttonError }, { status: 400 });
  }

  const result = await generateJobTicketPdfBuffer(
    supabase,
    orderId,
    ctx.tenant.id,
    ctx.tenant.name
  );
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const safeName = result.orderNumber.replace(/[^a-zA-Z0-9._-]/g, "_");

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="job-ticket-${safeName}.pdf"`,
    },
  });
}
