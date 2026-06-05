import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";

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

  const authById = new Map<
    string,
    { email: string | null; lastSignInAt: string | null }
  >();
  let authConfigured = false;

  try {
    const admin = createAdminClient();
    authConfigured = true;
    const { data: list } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    for (const u of list?.users ?? []) {
      authById.set(u.id, {
        email: u.email ?? null,
        lastSignInAt: u.last_sign_in_at ?? null,
      });
    }
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
