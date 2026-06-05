import { sendTeamInviteEmail } from "@/lib/email";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { User } from "@supabase/supabase-js";

type Admin = ReturnType<typeof createAdminClient>;

function normalizeInviteLink(link: string | null, redirectTo: string) {
  if (!link) return null;
  try {
    const url = new URL(link);
    url.searchParams.set("redirect_to", redirectTo);
    return url.toString();
  } catch {
    return link;
  }
}

/** Resolve auth user id + signup link via generateLink (does not send Supabase email). */
async function ensureUserAndSignupLink(
  admin: Admin,
  email: string,
  redirectTo: string,
  fullName: string | null,
  existing: User | null
) {
  const metadata = fullName ? { full_name: fullName } : undefined;
  let userId = existing?.id ?? null;

  if (existing && !existing.last_sign_in_at) {
    const recoveryAttempt = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });
    if (!recoveryAttempt.error && recoveryAttempt.data?.properties?.action_link) {
      return {
        userId: recoveryAttempt.data.user?.id ?? userId,
        inviteUrl: normalizeInviteLink(
          recoveryAttempt.data.properties.action_link,
          redirectTo
        ),
      };
    }
  }

  const inviteAttempt = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo, data: metadata },
  });

  if (!inviteAttempt.error && inviteAttempt.data?.properties?.action_link) {
    return {
      userId: inviteAttempt.data.user?.id ?? userId,
      inviteUrl: normalizeInviteLink(
        inviteAttempt.data.properties.action_link,
        redirectTo
      ),
    };
  }

  return { userId, inviteUrl: null as string | null };
}

/**
 * Team invite emails: Instantly for delivery, Supabase Auth for user + signup link.
 * Always returns a copyable signup link when Instantly cannot send.
 */
export async function sendTeamInvite(
  admin: Admin,
  params: {
    email: string;
    redirectTo: string;
    tenantName: string;
    fullName: string | null;
    existing: User | null;
  }
): Promise<{
  userId: string | null;
  emailSent: boolean;
  emailError: string | null;
  inviteUrl: string | null;
}> {
  const { email, redirectTo, tenantName, fullName, existing } = params;

  const { userId: linkedUserId, inviteUrl } = await ensureUserAndSignupLink(
    admin,
    email,
    redirectTo,
    fullName,
    existing
  );

  const userId = linkedUserId;

  if (!inviteUrl) {
    return {
      userId,
      emailSent: false,
      emailError:
        "Could not create an invite link. Check Supabase redirect URLs include /signup.",
      inviteUrl: null,
    };
  }

  const emailResult = await sendTeamInviteEmail({
    to: email,
    tenantName,
    inviteUrl,
    fullName,
  });

  if (emailResult.sent) {
    return {
      userId,
      emailSent: true,
      emailError: null,
      inviteUrl: null,
    };
  }

  return {
    userId,
    emailSent: false,
    emailError:
      emailResult.error ??
      "Could not send invite email. Copy the signup link below and send it to your teammate.",
    inviteUrl,
  };
}

/** @deprecated Use sendTeamInvite */
export const sendTeamInviteViaSupabase = sendTeamInvite;
