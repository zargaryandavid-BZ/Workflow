import { NextResponse } from "next/server";
import { lookupFulfillmentScan } from "@/lib/fulfillment-scan-public";
import { resolveKioskTenant } from "@/lib/kiosk-token";

/**
 * GET /api/kiosk/[token]/scan?q=ORDER_NUMBER
 *
 * Public floor lookup. Same payload as /api/fulfillment/scan.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: rawToken } = await params;
  const kiosk = await resolveKioskTenant(rawToken);
  if (!kiosk) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  return lookupFulfillmentScan(kiosk.supabase, kiosk.tenantId, q);
}
