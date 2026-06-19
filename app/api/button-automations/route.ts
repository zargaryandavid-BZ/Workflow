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

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("button_automations")
    .select("*")
    .eq("tenant_id", ctx.tenant.id)
    .order("position", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ buttons: data ?? [] });
}

export async function POST(request: Request) {
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

  const validationError = validateButtonAutomationInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 422 });
  }

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("button_automations")
    .select("position")
    .eq("tenant_id", ctx.tenant.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const actionType = body.action_type as ButtonAutomationActionType;
  const { data, error } = await supabase
    .from("button_automations")
    .insert({
      tenant_id: ctx.tenant.id,
      name: body.name!.trim(),
      icon: body.icon?.trim() || null,
      action_type: actionType,
      column_ids: body.column_ids ?? [],
      config: buildButtonAutomationConfig(actionType, body.config),
      position: ((last as { position: number } | null)?.position ?? -1) + 1,
      enabled: body.enabled ?? true,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ button: data });
}
