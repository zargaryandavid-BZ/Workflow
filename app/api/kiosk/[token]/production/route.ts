import { NextResponse } from "next/server";
import { resolveKioskTenant } from "@/lib/kiosk-token";
import { listProductionOrders } from "@/lib/fulfillment-production";

/**
 * GET /api/kiosk/[token]/production
 * Public floor list of jobs in production. Same payload as
 * /api/fulfillment/production.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const kiosk = await resolveKioskTenant(token);
  if (!kiosk) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await listProductionOrders(kiosk.supabase, kiosk.tenantId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(result);
}
