import { NextResponse } from "next/server";
import { applyFulfillmentScanAction } from "@/lib/fulfillment-scan-public";
import { resolveFloorTenant } from "@/lib/kiosk-token";

/** Public floor move — no staff session. Tenant from kiosk token or Bazaar. */
export async function POST(request: Request) {
  const floor = await resolveFloorTenant();
  if (!floor) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data } = await floor.supabase
    .from("fulfillment_settings")
    .select("scan_column_config")
    .eq("tenant_id", floor.tenantId)
    .maybeSingle();

  const body = (await request.json().catch(() => ({}))) as {
    order_id?: string;
    button_id?: string;
    action?: string;
  };

  return applyFulfillmentScanAction({
    supabase: floor.supabase,
    tenantId: floor.tenantId,
    scanColumnConfig: data?.scan_column_config,
    body,
    via: "floor_scan",
  });
}
