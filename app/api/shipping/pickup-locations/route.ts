import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  ensureShippingSettings,
  loadPickupLocations,
} from "@/lib/shipping-settings";
import { toStaffPickupLocation } from "@/lib/pickup-locations";

/** Signed-in staff: pickup addresses for ready-to-ship SMS (no FedEx secrets). */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  try {
    const settings = await ensureShippingSettings(supabase, ctx.tenant.id);
    const rows = await loadPickupLocations(supabase, ctx.tenant.id);
    const locations =
      rows.length > 0
        ? rows.map(toStaffPickupLocation)
        : [
            toStaffPickupLocation({
              id: "settings",
              tenant_id: ctx.tenant.id,
              name: settings.shipper_street?.trim() || "Shop",
              street: settings.shipper_street ?? "",
              city: settings.shipper_city ?? "",
              state: settings.shipper_state ?? "",
              zip: settings.shipper_zip ?? "",
              country: settings.shipper_country ?? "US",
              hours_note: settings.pickup_hours_note,
              use_for_fedex: true,
              position: 0,
            }),
          ];
    return NextResponse.json({ locations });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load pickup locations";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
