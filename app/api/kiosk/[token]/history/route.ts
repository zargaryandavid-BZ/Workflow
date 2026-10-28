import { NextResponse } from "next/server";
import { resolveKioskTenant } from "@/lib/kiosk-token";
import {
  deliveryHistoryDays,
  loadDeliveryHistory,
} from "@/lib/scan-delivery-history.server";

/**
 * GET /api/kiosk/[token]/history?days=30
 *
 * Public floor "See history". Same data as /api/fulfillment/scan/history.
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

  try {
    return NextResponse.json(
      await loadDeliveryHistory({
        supabase: kiosk.supabase,
        tenantId: kiosk.tenantId,
        scanColumnConfig: kiosk.scanColumnConfig,
        days: deliveryHistoryDays(new URL(request.url).searchParams.get("days")),
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "History failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
