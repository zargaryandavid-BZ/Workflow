import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean;
    toColumn?: string | null;
    fromColumn?: string | null;
    rejectedToColumn?: string | null;
    config?: Record<string, unknown>;
  };
  const updates: Record<string, unknown> = {};
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.toColumn !== undefined) updates.to_column = body.toColumn || null;
  if (body.fromColumn !== undefined) updates.from_column = body.fromColumn || null;

  const supabase = await createClient();

  if (body.rejectedToColumn !== undefined || body.config !== undefined) {
    const { data: existing } = await supabase
      .from("automation_rules")
      .select("config")
      .eq("id", id)
      .maybeSingle();
    const nextConfig = {
      ...((existing?.config as Record<string, unknown> | null) ?? {}),
      ...(body.config ?? {}),
    };
    if (body.rejectedToColumn !== undefined) {
      nextConfig.rejected_to_column = body.rejectedToColumn || null;
    }
    if (body.config?.idle_value !== undefined) {
      const v = Number(body.config.idle_value);
      if (!Number.isFinite(v) || v < 1) {
        return NextResponse.json(
          { error: "idle_value must be a positive number" },
          { status: 400 }
        );
      }
      nextConfig.idle_value = Math.min(365, Math.round(v));
    }
    if (body.config?.idle_unit !== undefined) {
      const u = body.config.idle_unit;
      if (u !== "hours" && u !== "days" && u !== "working_days") {
        return NextResponse.json(
          { error: "idle_unit must be hours, days, or working_days" },
          { status: 400 }
        );
      }
      nextConfig.idle_unit = u;
    }
    updates.config = nextConfig;
  }

  const { data, error } = await supabase
    .from("automation_rules")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ rule: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("automation_rules")
    .delete()
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
