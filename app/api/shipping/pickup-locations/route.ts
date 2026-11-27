import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  ensureShippingSettings,
  loadPickupLocations,
} from "@/lib/shipping-settings";
import {
  pickDefaultPickupLocation,
  toStaffPickupLocation,
} from "@/lib/pickup-locations";
import { ordersScannedAtBoyd } from "@/lib/pickup-boyd";

/**
 * Signed-in staff: pickup addresses for ready-to-ship SMS (no FedEx secrets).
 * `?orderIds=a,b` also returns `defaultId`: 1025 E 16th St unless the order
 * was scanned in at Boyd ("Boyd Received") — then 306 Boyd St.
 */
export async function GET(request: Request) {
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
    const params = new URL(request.url).searchParams;
    const orderIds = (params.get("orderIds") ?? params.get("orderId") ?? "")
      .split(",")
      .filter(Boolean);
    const atBoyd = await ordersScannedAtBoyd(supabase, ctx.tenant.id, orderIds);
    const defaultId = pickDefaultPickupLocation(locations, atBoyd)?.id ?? null;
    return NextResponse.json({ locations, defaultId, atBoyd });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load pickup locations";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
