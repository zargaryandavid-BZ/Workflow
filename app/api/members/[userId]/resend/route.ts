import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { findAuthUserByEmail } from "@/lib/team-members";
import { sendTeamInvite } from "@/lib/team-invite";
import { isInvitePendingUser } from "@/lib/team-invite-metadata";
import { sendTeamInviteEmail, sendPasswordResetEmail } from "@/lib/email";

/**
 * POST /api/members/[userId]/resend
 *
 * Pending users  → resend invite link (recovery token via Instantly).
 * Active users   → send a password-reset link (recovery token via Instantly).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is not configured." },
      { status: 503 }
    );
  }

  // Verify this user belongs to the tenant.
  const { data: membership } = await admin
    .from("memberships")
    .select("user_id")
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  const { data: authData, error: authError } =
    await admin.auth.admin.getUserById(userId);
  if (authError || !authData?.user) {
    return NextResponse.json(
      { error: "Could not load user from Auth." },
      { status: 400 }
    );
  }
  const user = authData.user;
  const email = user.email;
  if (!email) {
    return NextResponse.json({ error: "User has no email." }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const isPending = isInvitePendingUser(user);

  if (isPending) {
    // Pending — resend the original invite flow.
    const signupParams = new URLSearchParams({ invite_email: email });
    const fullName =
      (user.user_metadata?.full_name as string | undefined) ?? null;
    if (fullName) signupParams.set("invite_name", fullName);
    const redirectTo = `${appUrl}/signup?${signupParams.toString()}`;

    const existing = await findAuthUserByEmail(admin, email);
    const result = await sendTeamInvite(admin, {
      email,
      redirectTo,
      tenantName: ctx.tenant.name,
      fullName,
      existing,
    });

    return NextResponse.json({
      ok: true,
      emailSent: result.emailSent,
      emailError: result.emailError ?? undefined,
      inviteUrl: result.inviteUrl ?? undefined,
    });
  }

  // Active — send a password-reset (recovery) link.
  const redirectTo = `${appUrl}/login`;
  const { data: linkData, error: linkError } =
    await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });

  if (linkError || !linkData?.properties?.action_link) {
    return NextResponse.json(
      { error: linkError?.message ?? "Could not generate reset link." },
      { status: 400 }
    );
  }

  const resetUrl = linkData.properties.action_link;
  const fullName =
    (user.user_metadata?.full_name as string | undefined) ?? null;

  const emailResult = await sendPasswordResetEmail({
    to: email,
    tenantName: ctx.tenant.name,
    resetUrl,
    fullName,
  });

  if (emailResult.sent) {
    return NextResponse.json({ ok: true, emailSent: true });
  }

  return NextResponse.json({
    ok: true,
    emailSent: false,
    emailError: emailResult.error ?? "Could not send email.",
    resetUrl,
  });
}
