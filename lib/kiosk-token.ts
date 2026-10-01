import { createAdminClient } from "@/lib/supabase/admin";

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

/**
 * Floor URL `/fulfillment/scan` with no login: env token, else the only
 * (or Bazaar) kiosk_token on fulfillment_settings.
 */
export async function resolveFloorScanKiosk() {
  const fromEnv = (
    process.env.KIOSK_TOKEN ??
    process.env.NEXT_PUBLIC_KIOSK_TOKEN ??
    ""
  ).trim();
  if (fromEnv) return resolveKioskTenant(fromEnv);

  const supabase = createAdminClient();
  const { data: rows } = await supabase
    .from("fulfillment_settings")
    .select("kiosk_token, tenant_id, scan_column_config")
    .not("kiosk_token", "is", null)
    .limit(8);

  if (!rows?.length) return null;
  if (rows.length === 1) {
    return resolveKioskTenant(String(rows[0].kiosk_token));
  }

  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, name")
    .in(
      "id",
      rows.map((r) => r.tenant_id as string)
    );
  const bazaar = (tenants ?? []).find((t) =>
    String((t as { name?: string }).name ?? "")
      .toLowerCase()
      .includes("bazaar")
  );
  const row = bazaar
    ? rows.find((r) => r.tenant_id === (bazaar as { id: string }).id)
    : rows[0];
  return resolveKioskTenant(String(row?.kiosk_token ?? ""));
}
