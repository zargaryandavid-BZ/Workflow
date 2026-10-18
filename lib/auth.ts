import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TENANT_COOKIE } from "@/lib/constants";
import type { Membership, Role, Tenant } from "@/lib/types";

/**
 * Resolve the signed-in user WITHOUT a round-trip to the Auth server on every
 * request. `getClaims()` verifies the login token locally using the project's
 * asymmetric signing key (cached JWKS) — no network hop, no auth-DB reads. This
 * was the single most-called thing in the whole system (tens of millions of
 * `sessions`/`mfa`/`identities`/`users` reads), because the old `getUser()`
 * re-validated against the Auth server on literally every navigation.
 *
 * Safety: if local verification can't produce a user (token near/expired, a
 * symmetric-key project, or any edge case), we fall straight back to
 * `getUser()` — the exact previous behavior, which also refreshes the session.
 * Worst case it is as slow as before; it can NEVER lock anyone out.
 */
async function resolveAuthUser(
  supabase: SupabaseClient
): Promise<{ id: string; email: string | null } | null> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims as
      | { sub?: string; email?: string }
      | undefined;
    if (!error && claims?.sub) {
      return { id: claims.sub, email: claims.email ?? null };
    }
  } catch {
    // fall through to the authoritative getUser() path
  }
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  return user ? { id: user.id, email: user.email ?? null } : null;
}

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
 * The active tenant is taken from the `ppm_tenant` cookie when valid; otherwise
 * it defaults to the BazaarPrinting workspace when the user belongs to it, and
 * only then falls back to the first membership.
 */
// Wrapped in React `cache()` so the auth round-trip + memberships/profile
// queries run ONCE per request even though the layout, the page and any
// server helpers all call it in the same render. Removes an extra
// supabase.auth.getUser() network hop + 2 queries from every navigation.
export const getTenantContext = cache(async function getTenantContext(): Promise<TenantContext | null> {
  const supabase = await createClient();
  const [user, cookieStore] = await Promise.all([
    resolveAuthUser(supabase),
    cookies(),
  ]);
  if (!user) return null;

  // Memberships + profile in parallel — both only need user.id.
  const [{ data: memberships }, { data: profile }] = await Promise.all([
    supabase
      .from("memberships")
      .select("user_id, tenant_id, role, created_at, tenant:tenants(*)")
      .eq("user_id", user.id),
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const typed = (memberships ?? []) as unknown as (Membership & {
    tenant: Tenant;
  })[];

  if (typed.length === 0) return null;

  const preferred = cookieStore.get(TENANT_COOKIE)?.value;
  // Order of preference: explicit cookie choice → BazaarPrinting workspace →
  // first membership. Keeps a user's manual switch sticky while defaulting new
  // sessions to the live BazaarPrinting board instead of an empty workspace.
  const active =
    typed.find((m) => m.tenant_id === preferred) ??
    typed.find((m) => (m.tenant?.name ?? "").toLowerCase().includes("bazaar")) ??
    typed[0];

  return {
    userId: user.id,
    email: user.email ?? null,
    fullName: (profile as { full_name: string | null } | null)?.full_name ?? null,
    tenant: active.tenant,
    role: active.role,
    memberships: typed,
  };
});

/**
 * Verifies the user is a member of the given tenant and returns their role.
 * Throws when the user is not authenticated or not a member.
 */
export async function requireTenantMember(
  tenantId: string
): Promise<{ userId: string; role: Role }> {
  const supabase = await createClient();
  const user = await resolveAuthUser(supabase);
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
