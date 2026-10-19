import { NextResponse } from "next/server";
import { lookupFulfillmentScan } from "@/lib/fulfillment-scan-public";
import { resolveFloorTenant } from "@/lib/kiosk-token";

/** Public floor lookup — no staff session. Tenant from kiosk token or Bazaar. */
export async function GET(request: Request) {
  const floor = await resolveFloorTenant();
  if (!floor) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  return lookupFulfillmentScan(floor.supabase, floor.tenantId, q);
}
