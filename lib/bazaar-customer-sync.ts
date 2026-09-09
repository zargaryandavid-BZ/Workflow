import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadBazaarPortalSyncConfig } from "@/lib/bazaar-portal-sync";

/**
 * Fire-and-forget: push updated phone/email/name to Bazaar CRM.
 * No-ops when the customer has no crm_customer_id or the tenant has no Bazaar URL/key.
 *
 * Auth matches portal status callbacks (`x-webhook-secret: osk_…`).
 * Confirm PATCH `/api/v1/customers/{id}` with Bazaar if CRM does not update.
 */
export async function syncCustomerToBazaar(
  supabase: SupabaseClient,
  tenantId: string,
  customerId: string,
  updates: { phone?: string | null; email?: string | null; name?: string }
): Promise<void> {
  const { data: customer } = await supabase
    .from("customers")
    .select("crm_customer_id")
    .eq("id", customerId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const crmCustomerId =
    typeof customer?.crm_customer_id === "string"
      ? customer.crm_customer_id.trim()
      : "";
  if (!crmCustomerId) return;

  const cfg = await loadBazaarPortalSyncConfig(supabase, tenantId);
  const apiUrl = cfg.bazaar_api_url;
  const osk = Object.values(cfg.bazaar_portal_inbound_keys)[0];
  if (!apiUrl || !osk) return;

  const body: Record<string, string | null> = {};
  if (updates.phone !== undefined) body.phone = updates.phone ?? null;
  if (updates.email !== undefined) body.email = updates.email ?? null;
  if (updates.name !== undefined) body.name = updates.name;

  if (Object.keys(body).length === 0) return;

  try {
    const res = await fetch(`${apiUrl}/api/v1/customers/${crmCustomerId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": osk,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(
        `[bazaar-customer-sync] PATCH customer ${crmCustomerId} failed: ${res.status}`,
        text.slice(0, 300)
      );
    }
  } catch (err) {
    console.warn("[bazaar-customer-sync] fetch error:", err);
  }
}
