import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShippingClientChoice } from "@/lib/types";

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
 * Split destinations by the customer's choice:
 *   • pickup  → a column named like "Pickup"
 *   • shipping (delivery / FedEx / Uber / Curri) → a column named like "Shipping"
 * "Pickup" excludes nothing tricky; "shipping" is the present-tense word, so it
 * matches "Shipping" / "Shipping Selected" but NOT "Shipped Customer" (past) or
 * "Ship Opt" (the shared fallback). When the matching split column does not
 * exist on the board, callers fall back to the single Ship Opt column — so a
 * board that hasn't added the two columns keeps working exactly as before.
 */
const PICKUP_NAME = /\bpick\s*-?\s*up\b/i;
const SHIPPING_NAME = /shipping/i;

export function isPickupSelectedColumnName(
  name: string | null | undefined
): boolean {
  return PICKUP_NAME.test(name ?? "");
}

export function isShippingSelectedColumnName(
  name: string | null | undefined
): boolean {
  return SHIPPING_NAME.test(name ?? "");
}

/** True for every choice that is a delivery (not a self/warehouse pickup). */
function isShippingChoice(choice: ShippingClientChoice | null | undefined): boolean {
  return choice === "delivery" || choice === "uber" || choice === "curri";
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

/**
 * Destination for a confirmed choice, split by pickup vs shipping. Falls back to
 * the single Ship Opt column (rule or name) when the matching split column is
 * not on the board, so nothing breaks if the two columns haven't been added.
 */
export async function resolveShippingChoiceColumnId(
  client: SupabaseClient,
  tenantId: string,
  choice: ShippingClientChoice | null | undefined
): Promise<string | null> {
  const fallback = () => resolveShippingOptColumnId(client, tenantId);
  if (!choice) return fallback();

  const { data: columns } = await client
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", tenantId);
  const cols = (columns ?? []) as { id: string; name: string | null }[];

  if (choice === "pickup") {
    const pickup = cols.find((c) => isPickupSelectedColumnName(c.name));
    if (pickup) return pickup.id;
  } else if (isShippingChoice(choice)) {
    const shipping = cols.find((c) => isShippingSelectedColumnName(c.name));
    if (shipping) return shipping.id;
  }
  return fallback();
}
