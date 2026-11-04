import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  deliveryHistoryDays,
  loadDeliveryHistory,
} from "@/lib/scan-delivery-history.server";
import { verifySentHistoryShareToken } from "@/lib/sent-history-share";
import { sentHistoryShareSecret } from "@/lib/sent-history-share.server";

/**
 * GET /api/public/share/sent-history/[token]?days=
 * Read-only Sent history for an external share link (signed, expiring token).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const tenantId = verifySentHistoryShareToken(token, sentHistoryShareSecret());
  if (!tenantId) {
    return NextResponse.json(
      { error: "This link is invalid or has expired" },
      { status: 404 }
    );
  }

  const supabase = createAdminClient();
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
