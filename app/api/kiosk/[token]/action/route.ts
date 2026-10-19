import { NextResponse } from "next/server";
import { applyFulfillmentScanAction } from "@/lib/fulfillment-scan-public";
import { resolveKioskTenant } from "@/lib/kiosk-token";

/**
 * POST /api/kiosk/[token]/action
 *
 * Public floor move. Same post-move hooks as /api/fulfillment/scan/action.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: rawToken } = await params;
  const kiosk = await resolveKioskTenant(rawToken);
  if (!kiosk) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    order_id?: string;
    button_id?: string;
    action?: string;
  };

  return applyFulfillmentScanAction({
    supabase: kiosk.supabase,
    tenantId: kiosk.tenantId,
    scanColumnConfig: kiosk.scanColumnConfig,
    body,
    via: "kiosk_scan",
  });
}
