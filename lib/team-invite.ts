import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { formatAuthEmailError } from "@/lib/auth-email-errors";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { User } from "@supabase/supabase-js";

type Admin = ReturnType<typeof createAdminClient>;

function createAnonAuthClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function isRateLimitError(message: string) {
  const lower = message.toLowerCase();
  return lower.includes("rate limit") || lower.includes("too many");
}

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

/** Resolve auth user id + a signup link (invite or recovery) without sending email. */
async function ensureUserAndSignupLink(
  admin: Admin,
  email: string,
  redirectTo: string,
  fullName: string | null,
  existing: User | null
) {
  const metadata = fullName ? { full_name: fullName } : undefined;
  let userId = existing?.id ?? null;

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

  if (existing) {
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

  return { userId, inviteUrl: null as string | null };
}

/**
 * Team invite emails: Supabase Auth only (never Instantly).
 * Always returns a copyable signup link when email cannot be sent (rate limit, etc.).
 */
export async function sendTeamInviteViaSupabase(
  admin: Admin,
  params: {
    email: string;
    redirectTo: string;
    fullName: string | null;
    existing: User | null;
  }
): Promise<{
  userId: string | null;
  emailSent: boolean;
  emailError: string | null;
  inviteUrl: string | null;
}> {
  const { email, redirectTo, fullName, existing } = params;
  const metadata = fullName ? { full_name: fullName } : undefined;

  const { userId: linkedUserId, inviteUrl: signupLink } =
    await ensureUserAndSignupLink(admin, email, redirectTo, fullName, existing);

  let userId = linkedUserId;
  let inviteUrl = signupLink;
  let emailSent = false;
  let emailError: string | null = null;

  const anon = createAnonAuthClient();

  if (!existing) {
    const { data: invited, error: inviteError } =
      await admin.auth.admin.inviteUserByEmail(email, {
        data: metadata,
        redirectTo,
      });

    if (invited?.user) {
      userId = invited.user.id;
      emailSent = true;
      return { userId, emailSent, emailError: null, inviteUrl: null };
    }

    if (inviteError) {
      const { data: list } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      const created = list?.users.find(
        (u) => u.email?.toLowerCase() === email.toLowerCase()
      );
      if (created && !userId) {
        const retry = await sendTeamInviteViaSupabase(admin, {
          email,
          redirectTo,
          fullName,
          existing: created,
        });
        return retry;
      }

      emailError = formatAuthEmailError(inviteError.message);
    }
  } else if (!existing.last_sign_in_at) {
    userId = existing.id;

    const { error: mailError } = await anon.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (!mailError) {
      emailSent = true;
      return { userId, emailSent, emailError: null, inviteUrl: null };
    }

    emailError = formatAuthEmailError(mailError.message);
  } else {
    return { userId, emailSent: false, emailError: null, inviteUrl: null };
  }

  if (!emailSent) {
    if (!inviteUrl) {
      const backup = await ensureUserAndSignupLink(
        admin,
        email,
        redirectTo,
        fullName,
        existing
      );
      userId = backup.userId ?? userId;
      inviteUrl = backup.inviteUrl;
    }

    if (inviteUrl) {
      emailError = isRateLimitError(emailError ?? "")
        ? `${emailError} Copy the signup link below and send it to your teammate.`
        : emailError ??
          "Supabase could not send the invite email. Copy the signup link below.";
    } else if (!userId) {
      emailError =
        emailError ??
        "Could not create an invite link. Check Supabase redirect URLs include /signup.";
    }
  }

  return { userId, emailSent, emailError, inviteUrl };
}
