import type { User } from "@supabase/supabase-js";

export const INVITE_PENDING_META = "invite_pending";
export const INVITE_COMPLETED_META = "invite_completed";

type InviteUserLike = {
  user_metadata?: Record<string, unknown> | null;
  last_sign_in_at?: string | null;
};

/** True until the invitee finishes password setup on /signup. */
export function isInvitePendingUser(
  user: InviteUserLike | null | undefined
): boolean {
  if (!user) return false;
  const meta = user.user_metadata ?? {};
  if (meta[INVITE_COMPLETED_META] === true) return false;
  if (meta[INVITE_PENDING_META] === true) return true;
  // Legacy invites before metadata existed: never signed in.
  return !user.last_sign_in_at;
}

export function isFullyActiveTeamMember(
  user: InviteUserLike | null | undefined
): boolean {
  return Boolean(user) && !isInvitePendingUser(user);
}

export function invitePendingMetadata(
  fullName: string | null,
  existing?: Record<string, unknown> | null
): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    ...(fullName ? { full_name: fullName } : {}),
    [INVITE_PENDING_META]: true,
    [INVITE_COMPLETED_META]: false,
  };
}

export function inviteCompletedMetadata(
  existing?: Record<string, unknown> | null,
  fullName?: string | null
): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    ...(fullName ? { full_name: fullName } : {}),
    [INVITE_PENDING_META]: false,
    [INVITE_COMPLETED_META]: true,
  };
}

export type AuthInviteState = {
  email: string | null;
  lastSignInAt: string | null;
  userMetadata: Record<string, unknown> | null;
};

export function memberIsPendingFromAuth(
  auth: AuthInviteState | undefined
): boolean {
  if (!auth) return false;
  return isInvitePendingUser({
    user_metadata: auth.userMetadata,
    last_sign_in_at: auth.lastSignInAt,
  });
}
