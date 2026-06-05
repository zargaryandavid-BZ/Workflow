import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { isAssignableRole } from "@/lib/constants";
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
  };
  if (!isAssignableRole(body.role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }
  const role: Role = body.role;

  const supabase = await createClient();

  // Prevent demoting the last remaining admin.
  if (role !== "admin") {
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

  const { error } = await supabase
    .from("memberships")
    .update({ role })
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
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

  const supabase = await createClient();
  const { error } = await supabase
    .from("memberships")
    .delete()
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
