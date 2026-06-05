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
    rejectedToColumn?: string | null;
  };
  const updates: Record<string, unknown> = {};
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.toColumn !== undefined) updates.to_column = body.toColumn || null;

  const supabase = await createClient();

  if (body.rejectedToColumn !== undefined) {
    const { data: existing } = await supabase
      .from("automation_rules")
      .select("config")
      .eq("id", id)
      .maybeSingle();
    updates.config = {
      ...((existing?.config as Record<string, unknown> | null) ?? {}),
      rejected_to_column: body.rejectedToColumn || null,
    };
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
