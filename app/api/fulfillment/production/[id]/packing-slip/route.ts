import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { createClient } from "@/lib/supabase/server";
import { generatePackingSlipPdfBuffer } from "@/lib/packing-slip-generate";
import { orderIsInActiveProduction } from "@/lib/fulfillment-production";

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
  const gate = await orderIsInActiveProduction(
    supabase,
    ctx.tenant.id,
    orderId
  );
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const result = await generatePackingSlipPdfBuffer(
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
      "Content-Disposition": `inline; filename="packing-slip-${safeName}-${result.part}of${result.totalParts}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
