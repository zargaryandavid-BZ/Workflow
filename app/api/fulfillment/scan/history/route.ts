import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { createClient } from "@/lib/supabase/server";
import {
  deliveryHistoryDays,
  loadDeliveryHistory,
} from "@/lib/scan-delivery-history.server";

/**
 * GET /api/fulfillment/scan/history?days=30
 *
 * Scan → Sender "See history": orders moved into Sender button columns.
 */
export async function GET(request: Request) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const tenantId = auth.ctx.tenant.id;

  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("fulfillment_settings")
    .select("scan_column_config")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  try {
    return NextResponse.json(
      await loadDeliveryHistory({
        supabase,
        tenantId,
        scanColumnConfig: settings?.scan_column_config,
        days: deliveryHistoryDays(new URL(request.url).searchParams.get("days")),
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "History failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
