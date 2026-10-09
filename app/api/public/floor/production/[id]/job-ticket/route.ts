import { NextResponse } from "next/server";
import { resolveFloorTenant } from "@/lib/kiosk-token";
import { generateJobTicketPdfBuffer } from "@/lib/job-ticket-generate";
import { orderIsInActiveProduction } from "@/lib/fulfillment-production";

export const runtime = "nodejs";
export const maxDuration = 180;

/** Public floor print — no staff session. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const floor = await resolveFloorTenant();
  if (!floor) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { supabase, tenantId } = floor;
  const gate = await orderIsInActiveProduction(supabase, tenantId, orderId);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();

  const result = await generateJobTicketPdfBuffer(
    supabase,
    orderId,
    tenantId,
    (tenant as { name?: string } | null)?.name ?? ""
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
