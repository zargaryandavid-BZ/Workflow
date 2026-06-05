import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";
import type { User } from "@supabase/supabase-js";

type Admin = ReturnType<typeof createAdminClient>;

async function fetchAuthUsersByIds(
  admin: Admin,
  userIds: string[]
): Promise<
  Map<string, { email: string | null; lastSignInAt: string | null }>
> {
  const authById = new Map<
    string,
    { email: string | null; lastSignInAt: string | null }
  >();
  if (userIds.length === 0) return authById;

  await Promise.all(
    userIds.map(async (userId) => {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (error || !data.user) return;
      authById.set(userId, {
        email: data.user.email ?? null,
        lastSignInAt: data.user.last_sign_in_at ?? null,
      });
    })
  );

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

export interface TeamMemberRow {
  user_id: string;
  role: Role;
  created_at: string;
  profile: Profile | null;
  email: string | null;
  pending: boolean;
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
    { email: string | null; lastSignInAt: string | null }
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
      pending: !auth?.lastSignInAt,
    };
  });

  return { members, error: null, authConfigured };
}
