import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Role, TeamMemberRow } from "@/lib/types";
import { memberIsPendingFromAuth } from "@/lib/team-invite-metadata";
import type { User } from "@supabase/supabase-js";

export type { TeamMemberRow };

type Admin = ReturnType<typeof createAdminClient>;

async function fetchAuthUsersByIds(
  admin: Admin,
  userIds: string[]
): Promise<
  Map<
    string,
    {
      email: string | null;
      lastSignInAt: string | null;
      userMetadata: Record<string, unknown> | null;
    }
  >
> {
  const authById = new Map<
    string,
    {
      email: string | null;
      lastSignInAt: string | null;
      userMetadata: Record<string, unknown> | null;
    }
  >();
  if (userIds.length === 0) return authById;

  const results = await Promise.allSettled(
    userIds.map(async (userId) => {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (error || !data.user) return null;
      return {
        userId,
        email: data.user.email ?? null,
        lastSignInAt: data.user.last_sign_in_at ?? null,
        userMetadata:
          (data.user.user_metadata as Record<string, unknown> | null) ?? null,
      };
    })
  );
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    authById.set(result.value.userId, {
      email: result.value.email,
      lastSignInAt: result.value.lastSignInAt,
      userMetadata: result.value.userMetadata,
    });
  }

  return authById;
}

/** Look up a single auth user by email without loading the full user directory. */
export async function findAuthUserByEmail(
  admin: Admin,
  email: string
): Promise<User | null> {
  const normalized = email.toLowerCase();
  let page = 1;
  const perPage = 200;

  while (page <= 10) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage });
    const users = data?.users ?? [];
    const match = users.find(
      (u) => u.email?.toLowerCase() === normalized
    );
    if (match) return match;
    if (users.length < perPage) break;
    page++;
  }

  return null;
}

/**
 * Loads team members from public.memberships + profiles, enriched with auth
 * emails from the service-role client. memberships has no FK to profiles, so
 * those queries are run separately (same pattern as the board page).
 */
export async function loadTeamMembers(tenantId: string): Promise<{
  members: TeamMemberRow[];
  error: string | null;
  authConfigured: boolean;
}> {
  const supabase = await createClient();
  const { data: membershipRows, error: membershipError } = await supabase
    .from("memberships")
    .select("user_id, role, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });

  if (membershipError) {
    return { members: [], error: membershipError.message, authConfigured: false };
  }

  const rows = membershipRows ?? [];
  const userIds = rows.map((r) => r.user_id);

  const profilesById = new Map<string, Profile>();
  if (userIds.length > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url, created_at")
      .in("id", userIds);
    if (profileError) {
      return { members: [], error: profileError.message, authConfigured: false };
    }
    for (const p of (profiles ?? []) as Profile[]) {
      profilesById.set(p.id, p);
    }
  }

  let authById = new Map<
    string,
    {
      email: string | null;
      lastSignInAt: string | null;
      userMetadata: Record<string, unknown> | null;
    }
  >();
  let authConfigured = false;

  try {
    const admin = createAdminClient();
    authConfigured = true;
    authById = await fetchAuthUsersByIds(admin, userIds);
  } catch {
    authConfigured = false;
  }

  const members: TeamMemberRow[] = rows.map((r) => {
    const auth = authById.get(r.user_id);
    return {
      user_id: r.user_id,
      role: r.role as Role,
      created_at: r.created_at,
      profile: profilesById.get(r.user_id) ?? null,
      email: auth?.email ?? null,
      pending: memberIsPendingFromAuth(auth),
    };
  });

  return { members, error: null, authConfigured };
}

/**
 * Removes a user from a tenant. When they belong to no other workspaces,
 * deletes their Supabase Auth account (profile + memberships cascade).
 */
export async function removeTeamMemberFromTenant(
  admin: Admin,
  tenantId: string,
  userId: string
): Promise<
  | { ok: true; authUserDeleted: boolean }
  | { ok: false; error: string; status: number }
> {
  const { data: membership, error: lookupError } = await admin
    .from("memberships")
    .select("user_id, role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (lookupError) {
    return { ok: false, error: lookupError.message, status: 400 };
  }
  if (!membership) {
    return { ok: false, error: "Member not found.", status: 404 };
  }

  if (membership.role === "admin") {
    const { count, error: adminCountError } = await admin
      .from("memberships")
      .select("user_id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("role", "admin");
    if (adminCountError) {
      return { ok: false, error: adminCountError.message, status: 400 };
    }
    if ((count ?? 0) <= 1) {
      return {
        ok: false,
        error: "At least one admin is required.",
        status: 400,
      };
    }
  }

  const { error: deleteError } = await admin
    .from("memberships")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  if (deleteError) {
    return { ok: false, error: deleteError.message, status: 400 };
  }

  const { count: remainingCount, error: remainingError } = await admin
    .from("memberships")
    .select("user_id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (remainingError) {
    return { ok: false, error: remainingError.message, status: 400 };
  }

  if ((remainingCount ?? 0) > 0) {
    return { ok: true, authUserDeleted: false };
  }

  const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId);
  if (authDeleteError) {
    return { ok: false, error: authDeleteError.message, status: 400 };
  }

  return { ok: true, authUserDeleted: true };
}
