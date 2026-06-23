import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { isFastActionButtonColor } from "@/lib/fast-action-buttons";
import {
  fastActionButtonsMigrationMessage,
  loadAllFastActionButtonsWithStatus,
} from "@/lib/fast-action-buttons.server";
import { normalizeVisibilityMode } from "@/lib/check-visibility";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const { buttons, migrationRequired } = await loadAllFastActionButtonsWithStatus(
    supabase,
    ctx.tenant.id
  );

  if (migrationRequired) {
    return NextResponse.json({ buttons: [], migrationRequired: true });
  }
  return NextResponse.json({ buttons });
}

export async function POST(request: Request) {
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
  };

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Button name is required" }, { status: 422 });
  }
  if (!body.destination_column_id) {
    return NextResponse.json(
      { error: "A destination column is required" },
      { status: 422 }
    );
  }

  const color = isFastActionButtonColor(body.color) ? body.color : "blue";

  const supabase = await createClient();

  const { migrationRequired } = await loadAllFastActionButtonsWithStatus(
    supabase,
    ctx.tenant.id
  );
  if (migrationRequired) {
    return NextResponse.json(
      { error: fastActionButtonsMigrationMessage() },
      { status: 503 }
    );
  }

  // Verify destination column belongs to the tenant.
  const { data: col } = await supabase
    .from("board_columns")
    .select("id")
    .eq("id", body.destination_column_id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!col) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }

  const { data: last } = await supabase
    .from("fast_action_buttons")
    .select("position")
    .eq("tenant_id", ctx.tenant.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const visibilityMode = normalizeVisibilityMode(body.visibility_mode);

  const { data, error } = await supabase
    .from("fast_action_buttons")
    .insert({
      tenant_id: ctx.tenant.id,
      name: body.name.trim(),
      color,
      destination_column_id: body.destination_column_id,
      show_in_columns: body.show_in_columns ?? [],
      visible_to_roles: body.visible_to_roles ?? [],
      visibility_mode: visibilityMode,
      visibility_roles: body.visibility_roles ?? [],
      visibility_users: body.visibility_users ?? [],
      notification_rule_id: body.notification_rule_id ?? null,
      enabled: body.enabled ?? true,
      position: ((last as { position: number } | null)?.position ?? -1) + 1,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ button: data });
}
