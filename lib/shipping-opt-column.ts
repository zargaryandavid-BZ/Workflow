import type { SupabaseClient } from "@supabase/supabase-js";

/** Column the card should land in after pickup / FedEx / self FedEx / Uber. */
const SHIP_OPT_NAME = /ship\s*opt/i;

export function isShippingOptColumnName(name: string | null | undefined): boolean {
  return SHIP_OPT_NAME.test(name ?? "");
}

export function matchShippingOptColumnId(
  columns: { id: string; name: string | null }[]
): string | null {
  const named = columns.find((c) => isShippingOptColumnName(c.name));
  return named?.id ?? null;
}

/**
 * Destination for a confirmed shipping choice:
 * enabled `on_shipping_opt_selected` rule, else a column named like "Ship Opt".
 */
export async function resolveShippingOptColumnId(
  client: SupabaseClient,
  tenantId: string
): Promise<string | null> {
  const { data: rules } = await client
    .from("automation_rules")
    .select("to_column")
    .eq("tenant_id", tenantId)
    .eq("trigger", "on_shipping_opt_selected")
    .eq("enabled", true)
    .limit(1);

  const toColumnId = (rules as { to_column: string | null }[] | null)?.[0]
    ?.to_column;
  if (toColumnId) return toColumnId;

  const { data: columns } = await client
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", tenantId);

  return matchShippingOptColumnId(
    (columns ?? []) as { id: string; name: string | null }[]
  );
}
