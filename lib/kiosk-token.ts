import { createAdminClient } from "@/lib/supabase/admin";

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
