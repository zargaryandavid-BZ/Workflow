import { NextResponse } from "next/server";
import { resolveProductionFloorTenant } from "@/lib/kiosk-token";
import { listProductionOrders } from "@/lib/fulfillment-production";

/** Public floor list — no staff session. Tenant from kiosk token or Bazaar. */
export async function GET() {
  const floor = await resolveProductionFloorTenant();
  if (!floor) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await listProductionOrders(floor.supabase, floor.tenantId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(result);
}
