import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  inviteCompletedMetadata,
  isInvitePendingUser,
} from "@/lib/team-invite-metadata";
import { findAuthUserByEmail } from "@/lib/team-members";

/**
 * Lets a pending invitee set their password using only the signup page URL
 * (invite_email / invite_name). Only works before their first sign-in.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    fullName?: string;
  };

  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  const fullName = body.fullName?.trim() || null;

  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters." },
      { status: 400 }
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Server configuration error." },
      { status: 503 }
    );
  }

  const user = await findAuthUserByEmail(admin, email);
  if (!user) {
    return NextResponse.json(
      { error: "No invite found for this email. Ask your admin to resend." },
      { status: 404 }
    );
  }

  if (!isInvitePendingUser(user)) {
    return NextResponse.json(
      {
        error:
          "This account is already active. Sign in with your password instead.",
      },
      { status: 400 }
    );
  }

  const { count, error: membershipError } = await admin
    .from("memberships")
    .select("user_id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 400 });
  }
  if ((count ?? 0) === 0) {
    return NextResponse.json(
      { error: "No team invite found for this email." },
      { status: 404 }
    );
  }

  const metadata = inviteCompletedMetadata(
    user.user_metadata as Record<string, unknown> | undefined,
    fullName ?? undefined
  );

  const { error: updateError } = await admin.auth.admin.updateUserById(
    user.id,
    {
      password,
      email_confirm: true,
      user_metadata: metadata,
    }
  );
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  if (fullName) {
    await admin
      .from("profiles")
      .upsert({ id: user.id, full_name: fullName }, { onConflict: "id" });
  }

  return NextResponse.json({ ok: true });
}
