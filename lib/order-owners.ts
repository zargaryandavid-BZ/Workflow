import type { SupabaseClient } from "@supabase/supabase-js";

export interface OrderOwnerOption {
  id: string;
  name: string;
}

/** Team members with the account_manager role — valid order owners. */
export async function loadAccountManagerOwners(
  supabase: SupabaseClient,
  tenantId: string
): Promise<OrderOwnerOption[]> {
  const { data: members, error } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("role", "account_manager");

  if (error) throw new Error(error.message);

  const ids = [...new Set((members ?? []).map((m) => m.user_id as string))];
  if (ids.length === 0) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", ids);

  const nameById = new Map(
    ((profiles ?? []) as { id: string; full_name: string | null }[]).map(
      (p) => [p.id, p.full_name?.trim() || "Account manager"]
    )
  );

  return ids
    .map((id) => ({ id, name: nameById.get(id) ?? "Account manager" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

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
    .eq("role", "account_manager")
    .maybeSingle();
  return Boolean(data);
}
