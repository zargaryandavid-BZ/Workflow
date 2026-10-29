import { createAdminClient } from "@/lib/supabase/admin";
import { FLOOR_DEVICE_COOKIE } from "@/lib/floor-device-cookie";

export type KioskTenant = NonNullable<
  Awaited<ReturnType<typeof resolveKioskTenant>>
>;

/** Resolve tenant from a public kiosk URL token. Service role; no staff session. */
export async function resolveKioskTenant(token: string | undefined) {
  const trimmed = token?.trim() ?? "";
  if (!trimmed) return null;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("fulfillment_settings")
    .select("tenant_id, scan_column_config")
    .eq("kiosk_token", trimmed)
    .maybeSingle();

  if (!data?.tenant_id) return null;

  return {
    supabase,
    token: trimmed,
    tenantId: data.tenant_id as string,
    scanColumnConfig: data.scan_column_config,
  };
}


async function floorDeviceToken(): Promise<string> {
  const { cookies } = await import("next/headers");
  return (await cookies()).get(FLOOR_DEVICE_COOKIE)?.value?.trim() ?? "";
}

/** False until the kiosk_token migration is applied (no tokens to check). */
async function kioskTokensAvailable(): Promise<boolean> {
  const { error } = await createAdminClient()
    .from("fulfillment_settings")
    .select("kiosk_token")
    .limit(1);
  if (error) {
    console.error(
      "[kiosk] kiosk_token unavailable; floor pages open without a device token:",
      error.message
    );
  }
  return !error;
}

/**
 * Floor URL `/fulfillment/scan` with no login: only a device registered by
 * opening its `/kiosk/<token>` link (the token is kept in a cookie).
 */
export async function resolveFloorScanKiosk() {
  const token = await floorDeviceToken();
  return token ? resolveKioskTenant(token) : null;
}

/**
 * Tenant for public floor pages and their `/api/public/floor/*` APIs.
 * Requires a registered device; before the kiosk_token migration exists the
 * old no-token floor keeps working so stations are not locked out.
 */
export async function resolveFloorTenant() {
  const kiosk = await resolveFloorScanKiosk();
  if (kiosk) {
    return {
      supabase: kiosk.supabase,
      tenantId: kiosk.tenantId,
      token: kiosk.token,
    };
  }
  if (await kioskTokensAvailable()) return null;
  return resolveDefaultFloorTenant();
}

/**
 * The Bazaar workspace (or the only tenant). No device check: for read-only
 * lookups that are scoped some other way, e.g. Pulse CRM order artwork.
 */
export async function resolveDefaultFloorTenant() {
  const supabase = createAdminClient();
  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, name")
    .order("name");
  const rows = (tenants ?? []) as { id: string; name: string }[];
  if (rows.length === 0) return null;
  const bazaar = rows.find((t) => t.name.toLowerCase().includes("bazaar"));
  const picked = bazaar ?? rows[0];
  return { supabase, tenantId: picked.id, token: "" };
}
