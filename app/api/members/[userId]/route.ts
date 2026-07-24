import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantContext } from "@/lib/auth";
import { removeTeamMemberFromTenant } from "@/lib/team-members";
import { isAssignableRole } from "@/lib/constants";
import { normalizeSmsPhone, validateSmsRecipient } from "@/lib/sms";
import type { Role } from "@/lib/types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    role?: string;
    fullName?: string;
    phone?: string | null;
  };

  const supabase = await createClient();

  // Confirm the target belongs to this tenant before profile edits.
  const { data: membership } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  if (body.role !== undefined) {
    if (!isAssignableRole(body.role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    const role: Role = body.role;

    // Prevent demoting the last remaining admin.
    // Only relevant when the target user is currently an admin.
    if (role !== "admin") {
      const { data: current } = await supabase
        .from("memberships")
        .select("role")
        .eq("tenant_id", ctx.tenant.id)
        .eq("user_id", userId)
        .single();

      if (current?.role === "admin") {
        const { count } = await supabase
          .from("memberships")
          .select("user_id", { count: "exact", head: true })
          .eq("tenant_id", ctx.tenant.id)
          .eq("role", "admin");
        if ((count ?? 0) <= 1) {
          return NextResponse.json(
            { error: "At least one admin is required." },
            { status: 400 }
          );
        }
      }
    }

    const { error } = await supabase
      .from("memberships")
      .update({ role })
      .eq("tenant_id", ctx.tenant.id)
      .eq("user_id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const updatingProfile =
    body.fullName !== undefined || body.phone !== undefined;
  if (updatingProfile) {
    let admin;
    try {
      admin = createAdminClient();
    } catch {
      return NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY is not configured." },
        { status: 503 }
      );
    }

    const { data: existingProfile } = await admin
      .from("profiles")
      .select("full_name, phone")
      .eq("id", userId)
      .maybeSingle();

    const fullName =
      body.fullName !== undefined
        ? body.fullName.trim() || null
        : ((existingProfile as { full_name: string | null } | null)?.full_name ??
          null);

    let phone =
      body.phone !== undefined
        ? body.phone?.trim() || null
        : ((existingProfile as { phone: string | null } | null)?.phone ?? null);

    if (phone) {
      const phoneError = validateSmsRecipient(phone);
      if (phoneError) {
        return NextResponse.json({ error: phoneError }, { status: 400 });
      }
      phone = normalizeSmsPhone(phone);
    }

    if (body.fullName !== undefined) {
      const { data: existing } = await admin.auth.admin.getUserById(userId);
      if (existing?.user) {
        await admin.auth.admin.updateUserById(userId, {
          user_metadata: {
            ...(existing.user.user_metadata as
              | Record<string, unknown>
              | undefined),
            full_name: fullName,
          },
        });
      }
    }

    const { error: profileError } = await admin.from("profiles").upsert(
      { id: userId, full_name: fullName, phone },
      { onConflict: "id" }
    );
    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  if (userId === ctx.userId) {
    return NextResponse.json(
      { error: "You cannot remove yourself." },
      { status: 400 }
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      {
        error:
          "SUPABASE_SERVICE_ROLE_KEY is not configured. Add it to .env.local to manage team members.",
      },
      { status: 503 }
    );
  }

  const result = await removeTeamMemberFromTenant(
    admin,
    ctx.tenant.id,
    userId
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, authUserDeleted: result.authUserDeleted });
}
