import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isExplicitPreferredChannel,
  normalizePreferredChannel,
} from "@/lib/preferred-channel";
import type { PreferredChannel } from "@/lib/types";

export type CustomerNotifyPreference = {
  preferred: PreferredChannel;
  /** False when the customer never chose (DB default 'sms'). */
  explicit: boolean;
};

const NONE: CustomerNotifyPreference = { preferred: "sms", explicit: false };

/**
 * The saved notify default for the customer on an order (CRM / portal / manual
 * cards all point at customers via orders.customer_id). Tolerates the
 * preferred_channel_set_at column not existing yet.
 */
export async function loadOrderCustomerNotifyPreference(
  client: SupabaseClient,
  orderId: string,
  tenantId: string
): Promise<CustomerNotifyPreference> {
  try {
    const { data: order } = await client
      .from("orders")
      .select("customer_id")
      .eq("id", orderId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const customerId = (order as { customer_id?: string | null } | null)
      ?.customer_id;
    if (!customerId) return NONE;

    type PrefRow = {
      preferred_channel?: string | null;
      preferred_channel_set_at?: string | null;
    };
    let row: PrefRow | null;
    const withStamp = await client
      .from("customers")
      .select("preferred_channel, preferred_channel_set_at")
      .eq("id", customerId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (withStamp.error) {
      const plain = await client
        .from("customers")
        .select("preferred_channel")
        .eq("id", customerId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      row = (plain.data as PrefRow | null) ?? null;
    } else {
      row = (withStamp.data as PrefRow | null) ?? null;
    }
    if (!row) return NONE;
    return {
      preferred: normalizePreferredChannel(row.preferred_channel),
      explicit: isExplicitPreferredChannel(row),
    };
  } catch (err) {
    console.warn("[notify-preference] load failed", orderId, err);
    return NONE;
  }
}
