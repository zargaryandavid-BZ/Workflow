import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { findAuthUserByEmail, loadTeamMembers } from "@/lib/team-members";
import { sendTeamInvite } from "@/lib/team-invite";
import { isAssignableRole } from "@/lib/constants";
import type { Role } from "@/lib/types";

/** List all members for the active tenant (memberships + profiles + auth email). */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const { members, error, authConfigured } = await loadTeamMembers(
    ctx.tenant.id
  );
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }
  return NextResponse.json({ members, authConfigured });
}

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    role?: string;
    fullName?: string;
  };
  const email = body.email?.trim().toLowerCase();
  const fullName = body.fullName?.trim() || null;
  const role: Role = isAssignableRole(body.role) ? body.role : "designer";
  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const signupParams = new URLSearchParams({ invite_email: email });
  if (fullName) signupParams.set("invite_name", fullName);
  const redirectTo = `${appUrl}/signup?${signupParams.toString()}`;

  const existing = await findAuthUserByEmail(admin, email);
  const existed = Boolean(existing);
  const alreadyActive = Boolean(existing?.last_sign_in_at);

  let userId = existing?.id ?? null;
  let inviteUrl: string | null = null;
  let emailSent = false;
  let emailError: string | null = null;

  if (!alreadyActive) {
    const invite = await sendTeamInvite(admin, {
      email,
      redirectTo,
      tenantName: ctx.tenant.name,
      fullName,
      existing,
    });
    userId = invite.userId ?? userId;
    emailSent = invite.emailSent;
    emailError = invite.emailError;
    inviteUrl = invite.inviteUrl;
  }

  if (!userId) {
    return NextResponse.json(
      { error: "Could not resolve user for this invite." },
      { status: 400 }
    );
  }

  const { error: membershipError } = await admin.from("memberships").upsert(
    {
      user_id: userId,
      tenant_id: ctx.tenant.id,
      role,
    },
    { onConflict: "user_id,tenant_id" }
  );
  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 400 });
  }

  if (fullName) {
    await admin.auth.admin.updateUserById(userId, {
      user_metadata: { full_name: fullName },
    });
    await admin
      .from("profiles")
      .upsert({ id: userId, full_name: fullName }, { onConflict: "id" });
  }

  return NextResponse.json({
    ok: true,
    existed,
    alreadyActive,
    emailSent: alreadyActive ? false : emailSent,
    emailError: emailError ?? undefined,
    // Always return a link when Instantly did not send the invite email.
    inviteUrl:
      !alreadyActive && !emailSent ? (inviteUrl ?? undefined) : undefined,
  });
}
