import "server-only";

import { sendTeamInviteEmail } from "@/lib/email";
import {
  appAuthUrlFromRedirect,
  hashedTokenFromGenerateLink,
} from "@/lib/auth-email-link";
import {
  invitePendingMetadata,
  isInvitePendingUser,
} from "@/lib/team-invite-metadata";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { User } from "@supabase/supabase-js";

type Admin = ReturnType<typeof createAdminClient>;

/** Resolve auth user id + signup link via generateLink (does not send Supabase email). */
async function ensureUserAndSignupLink(
  admin: Admin,
  email: string,
  redirectTo: string,
  fullName: string | null,
  existing: User | null
) {
  const metadata = invitePendingMetadata(
    fullName,
    existing?.user_metadata as Record<string, unknown> | undefined
  );
  let userId = existing?.id ?? null;

  if (existing && isInvitePendingUser(existing)) {
    const recoveryAttempt = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });
    const hashed = hashedTokenFromGenerateLink(
      recoveryAttempt.data?.properties
    );
    if (!recoveryAttempt.error && hashed) {
      await admin.auth.admin.updateUserById(
        recoveryAttempt.data.user?.id ?? userId!,
        { user_metadata: metadata }
      );
      return {
        userId: recoveryAttempt.data.user?.id ?? userId,
        inviteUrl: appAuthUrlFromRedirect({
          redirectTo,
          hashedToken: hashed,
          type: "recovery",
        }),
      };
    }
  }

  const inviteAttempt = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo, data: metadata },
  });

  const inviteHashed = hashedTokenFromGenerateLink(
    inviteAttempt.data?.properties
  );
  if (!inviteAttempt.error && inviteHashed) {
    const linkedId = inviteAttempt.data.user?.id ?? userId;
    if (linkedId) {
      await admin.auth.admin.updateUserById(linkedId, {
        user_metadata: metadata,
      });
    }
    return {
      userId: linkedId,
      inviteUrl: appAuthUrlFromRedirect({
        redirectTo,
        hashedToken: inviteHashed,
        type: "invite",
      }),
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
