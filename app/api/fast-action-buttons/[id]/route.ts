import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { isFastActionButtonColor } from "@/lib/fast-action-buttons";
import { normalizeVisibilityMode } from "@/lib/check-visibility";

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
    color?: string;
    destination_column_id?: string | null;
    show_in_columns?: string[];
    visible_to_roles?: string[];
    visibility_mode?: string;
    visibility_roles?: string[];
    visibility_users?: string[];
    notification_rule_id?: string | null;
    enabled?: boolean;
    position?: number;
  };

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("fast_action_buttons")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (body.name !== undefined && !body.name.trim()) {
    return NextResponse.json({ error: "Button name is required" }, { status: 422 });
  }

  if (body.destination_column_id) {
    const { data: col } = await supabase
      .from("board_columns")
      .select("id")
      .eq("id", body.destination_column_id)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle();
    if (!col) {
      return NextResponse.json({ error: "Column not found" }, { status: 404 });
    }
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.color !== undefined) {
    updates.color = isFastActionButtonColor(body.color) ? body.color : existing.color;
  }
  if (body.destination_column_id !== undefined) {
    updates.destination_column_id = body.destination_column_id;
  }
  if (body.show_in_columns !== undefined) updates.show_in_columns = body.show_in_columns;
  if (body.visible_to_roles !== undefined) updates.visible_to_roles = body.visible_to_roles;
  if (body.visibility_mode !== undefined)
    updates.visibility_mode = normalizeVisibilityMode(body.visibility_mode);
  if (body.visibility_roles !== undefined) updates.visibility_roles = body.visibility_roles;
  if (body.visibility_users !== undefined) updates.visibility_users = body.visibility_users;
  if ("notification_rule_id" in body) updates.notification_rule_id = body.notification_rule_id ?? null;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.position !== undefined) updates.position = body.position;

  const { data, error } = await supabase
    .from("fast_action_buttons")
    .update(updates)
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ button: data });
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
    .from("fast_action_buttons")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
