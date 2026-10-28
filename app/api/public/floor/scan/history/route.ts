import { NextResponse } from "next/server";
import { resolveFloorTenant } from "@/lib/kiosk-token";
import {
  deliveryHistoryDays,
  loadDeliveryHistory,
} from "@/lib/scan-delivery-history.server";

/** Public floor "See history" — no staff session. Same data as staff. */
export async function GET(request: Request) {
  const floor = await resolveFloorTenant();
  if (!floor) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data } = await floor.supabase
    .from("fulfillment_settings")
    .select("scan_column_config")
    .eq("tenant_id", floor.tenantId)
    .maybeSingle();

  try {
    return NextResponse.json(
      await loadDeliveryHistory({
        supabase: floor.supabase,
        tenantId: floor.tenantId,
        scanColumnConfig: data?.scan_column_config,
        days: deliveryHistoryDays(new URL(request.url).searchParams.get("days")),
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "History failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
