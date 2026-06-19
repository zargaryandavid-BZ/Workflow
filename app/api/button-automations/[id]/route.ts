import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  buildButtonAutomationConfig,
  validateButtonAutomationInput,
} from "@/lib/button-automations";
import type {
  ButtonAutomationActionType,
  ButtonAutomationEmailConfig,
} from "@/lib/types";

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
    icon?: string | null;
    action_type?: ButtonAutomationActionType;
    column_ids?: string[];
    config?: ButtonAutomationEmailConfig;
    enabled?: boolean;
  };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("button_automations")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const nextActionType =
    body.action_type ?? (existing.action_type as ButtonAutomationActionType);
  const validationError = validateButtonAutomationInput({
    name: body.name ?? existing.name,
    action_type: nextActionType,
    config:
      body.config ??
      (existing.config as ButtonAutomationEmailConfig | undefined),
  });
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 422 });
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.icon !== undefined) updates.icon = body.icon?.trim() || null;
  if (body.column_ids !== undefined) updates.column_ids = body.column_ids;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.action_type !== undefined) {
    updates.action_type = body.action_type;
    updates.config = buildButtonAutomationConfig(body.action_type, body.config);
  } else if (body.config !== undefined) {
    updates.config = buildButtonAutomationConfig(
      existing.action_type as ButtonAutomationActionType,
      body.config
    );
  }

  const { data, error } = await supabase
    .from("button_automations")
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
    .from("button_automations")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
