import type { SupabaseClient } from "@supabase/supabase-js";

export interface OrderOwnerOption {
  id: string;
  name: string;
}

/** Roles that may be assigned as order owners. */
const ORDER_OWNER_ROLES = ["account_manager", "admin"] as const;

/** Team members with account_manager or admin role — valid order owners. */
export async function loadAccountManagerOwners(
  supabase: SupabaseClient,
  tenantId: string
): Promise<OrderOwnerOption[]> {
  const { data: members, error } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .in("role", [...ORDER_OWNER_ROLES]);

  if (error) throw new Error(error.message);

  const ids = [...new Set((members ?? []).map((m) => m.user_id as string))];
  if (ids.length === 0) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", ids);

  const nameById = new Map(
    ((profiles ?? []) as { id: string; full_name: string | null }[]).map(
      (p) => [p.id, p.full_name?.trim() || "Team member"]
    )
  );

  return ids
    .map((id) => ({ id, name: nameById.get(id) ?? "Team member" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** True when the user may be set as an order owner (account manager or admin). */
export async function isAccountManagerOwner(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .in("role", [...ORDER_OWNER_ROLES])
    .maybeSingle();
  return Boolean(data);
}
