import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { createClient } from "@/lib/supabase/server";
import { generateJobTicketPdfBuffer } from "@/lib/job-ticket-generate";
import { columnNameIsActiveProduction } from "@/lib/prepress-production-handoff";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id: orderId } = await params;

  const supabase = await createClient();
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, column_id")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .is("removed_at", null)
    .maybeSingle();

  if (orderError) {
    return NextResponse.json({ error: orderError.message }, { status: 500 });
  }
  if (!order?.column_id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const { data: column, error: colError } = await supabase
    .from("board_columns")
    .select("name")
    .eq("id", order.column_id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (colError) {
    return NextResponse.json({ error: colError.message }, { status: 500 });
  }
  if (!columnNameIsActiveProduction(column?.name ?? null)) {
    return NextResponse.json(
      { error: "Order is not in production" },
      { status: 409 }
    );
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
      "Content-Disposition": `inline; filename="job-ticket-${safeName}.pdf"`,
    },
  });
}
