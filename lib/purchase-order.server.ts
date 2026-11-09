import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureShortCustomerUrl } from "@/lib/short-link";
import type { PoHistoryEntry } from "@/lib/purchase-order";

export const PO_MIGRATION_HINT =
  "Run migration 20261108000000_outsource_purchase_orders.sql in Supabase, then try again.";

export function poMigrationMissing(message: string | undefined): boolean {
  return /purchase_orders|outsource_vendors|schema cache|does not exist/i.test(message ?? "");
}

/** Card fields by name ({ "Product": "Gift Bags", ... }) + specs. */
export async function loadOrderForPo(
  client: SupabaseClient,
  tenantId: string,
  orderId: string
): Promise<{
  order: { id: string; title: string; specs: Record<string, unknown>; due_date: string | null };
  fields: Record<string, unknown>;
} | null> {
  const { data: order } = await client
    .from("orders")
    .select("id, title, specs, due_date, tenant_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.tenant_id !== tenantId) return null;
  const { data: values } = await client
    .from("custom_field_values")
    .select("value, custom_fields!inner(name)")
    .eq("order_id", orderId);
  const fields: Record<string, unknown> = {};
  for (const row of (values ?? []) as Array<{
    value: unknown;
    custom_fields: { name?: string } | { name?: string }[] | null;
  }>) {
    const cf = Array.isArray(row.custom_fields) ? row.custom_fields[0] : row.custom_fields;
    if (cf?.name) fields[cf.name] = row.value;
  }
  return {
    order: {
      id: order.id as string,
      title: (order.title as string) ?? "",
      specs: ((order.specs as Record<string, unknown>) ?? {}) as Record<string, unknown>,
      due_date: (order.due_date as string | null) ?? null,
    },
    fields,
  };
}

export async function vendorPoUrl(
  client: SupabaseClient,
  tenantId: string,
  token: string
): Promise<string> {
  return ensureShortCustomerUrl(client, tenantId, `/po/${token}`);
}

export function appendHistory(
  history: unknown,
  entry: PoHistoryEntry
): PoHistoryEntry[] {
  const list = Array.isArray(history) ? (history as PoHistoryEntry[]) : [];
  return [...list, entry].slice(-100);
}
