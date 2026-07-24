import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { isTimeChipIcon } from "@/lib/time-chips";

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
    name?: string;
    icon?: string;
    enabled?: boolean;
    visible_all?: boolean;
    visible_column_ids?: string[];
    stamp_on_column_id?: string | null;
    position?: number;
  };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("time_chips")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isSystem = existing.kind === "system";
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (body.name !== undefined && !isSystem) updates.name = body.name.trim();
  if (body.icon !== undefined && isTimeChipIcon(body.icon)) {
    updates.icon = body.icon;
  }
  if (body.enabled !== undefined) updates.enabled = Boolean(body.enabled);
  if (body.visible_all !== undefined) {
    updates.visible_all = Boolean(body.visible_all);
    if (updates.visible_all) updates.visible_column_ids = [];
  }
  if (body.visible_column_ids !== undefined && !body.visible_all) {
    updates.visible_column_ids = Array.isArray(body.visible_column_ids)
      ? body.visible_column_ids.filter((x) => typeof x === "string")
      : [];
    updates.visible_all = false;
  }
  if (body.stamp_on_column_id !== undefined && !isSystem) {
    updates.stamp_on_column_id = body.stamp_on_column_id || null;
  }
  if (body.position !== undefined) updates.position = body.position;

  const { data, error } = await supabase
    .from("time_chips")
    .update(updates)
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ chip: data });
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
  const { data: existing } = await supabase
    .from("time_chips")
    .select("kind")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.kind === "system") {
    return NextResponse.json(
      { error: "System time chips cannot be deleted" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("time_chips")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
