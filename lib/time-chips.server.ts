import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SYSTEM_TIME_CHIP_DEFAULTS,
  type TimeChip,
} from "@/lib/time-chips";
import { isShippedCustomerColumn } from "@/lib/shipped-customer-column";

/** Ensure system time chips exist for a tenant (idempotent). */
export async function ensureSystemTimeChips(
  client: SupabaseClient,
  tenantId: string
): Promise<TimeChip[]> {
  const { data: existing } = await client
    .from("time_chips")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true });

  const rows = (existing ?? []) as TimeChip[];
  const have = new Set(
    rows.filter((r) => r.system_key).map((r) => r.system_key as string)
  );

  const missing = SYSTEM_TIME_CHIP_DEFAULTS.filter(
    (d) => !have.has(d.system_key)
  );

  if (missing.length > 0) {
    let shippedColumnIds: string[] = [];
    if (missing.some((d) => d.system_key === "shipped_entered")) {
      const { data: cols } = await client
        .from("board_columns")
        .select("id, name")
        .eq("tenant_id", tenantId);
      shippedColumnIds = ((cols ?? []) as { id: string; name: string }[])
        .filter((c) => isShippedCustomerColumn(c.name))
        .map((c) => c.id);
    }

    const { error } = await client.from("time_chips").insert(
      missing.map((d) => {
        const isShipped = d.system_key === "shipped_entered";
        return {
          tenant_id: tenantId,
          kind: "system",
          system_key: d.system_key,
          name: d.name,
          icon: d.icon,
          enabled: true,
          // Match legacy: truck date only on Shipped Customer columns when known.
          visible_all: isShipped ? shippedColumnIds.length === 0 : true,
          visible_column_ids: isShipped ? shippedColumnIds : [],
          stamp_on_column_id: null,
          position: d.position,
        };
      })
    );
    if (error) throw new Error(error.message);

    const { data: refreshed } = await client
      .from("time_chips")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true });
    return (refreshed ?? []) as TimeChip[];
  }

  return rows;
}

export async function listTimeChips(
  client: SupabaseClient,
  tenantId: string
): Promise<TimeChip[]> {
  return ensureSystemTimeChips(client, tenantId);
}
