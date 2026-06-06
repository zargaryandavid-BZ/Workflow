import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { TENANT_COOKIE } from "@/lib/constants";
import type { Membership, Role, Tenant } from "@/lib/types";

export interface TenantContext {
  userId: string;
  email: string | null;
  fullName: string | null;
  tenant: Tenant;
  role: Role;
  memberships: (Membership & { tenant: Tenant })[];
}

/**
 * Resolves the current user and their active tenant. Returns null when there
 * is no authenticated user or the user belongs to no tenants.
 *
 * The active tenant is taken from the `ppm_tenant` cookie when valid,
 * otherwise it falls back to the first membership.
 */
export async function getTenantContext(): Promise<TenantContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: memberships } = await supabase
    .from("memberships")
    .select("user_id, tenant_id, role, created_at, tenant:tenants(*)")
    .eq("user_id", user.id);

  const typed = (memberships ?? []) as unknown as (Membership & {
    tenant: Tenant;
  })[];

  if (typed.length === 0) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  const cookieStore = await cookies();
  const preferred = cookieStore.get(TENANT_COOKIE)?.value;
  const active =
    typed.find((m) => m.tenant_id === preferred) ?? typed[0];

  return {
    userId: user.id,
    email: user.email ?? null,
    fullName: (profile as { full_name: string | null } | null)?.full_name ?? null,
    tenant: active.tenant,
    role: active.role,
    memberships: typed,
  };
}

/**
 * Verifies the user is a member of the given tenant and returns their role.
 * Throws when the user is not authenticated or not a member.
 */
export async function requireTenantMember(
  tenantId: string
): Promise<{ userId: string; role: Role }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!membership) throw new Error("Forbidden");
  return { userId: user.id, role: (membership as { role: Role }).role };
}
