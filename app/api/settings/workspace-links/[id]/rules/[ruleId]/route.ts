import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string; ruleId: string }> };

export async function PATCH(request: Request, ctxParams: Ctx) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { id, ruleId } = await ctxParams.params;
  const supabase = await createClient();

  const { data: link } = await supabase
    .from("workspace_links")
    .select("id")
    .eq("id", id)
    .eq("source_tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean;
    triggerColumnId?: string;
    mirrorStartColumnId?: string;
    returnColumnId?: string | null;
    returnToColumnId?: string | null;
  };

  const updates: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") updates.enabled = body.enabled;
  if (body.triggerColumnId) updates.trigger_column_id = body.triggerColumnId;
  if (body.mirrorStartColumnId) {
    updates.mirror_start_column_id = body.mirrorStartColumnId;
  }
  if (body.returnColumnId !== undefined) {
    updates.return_column_id = body.returnColumnId || null;
  }
  if (body.returnToColumnId !== undefined) {
    updates.return_to_column_id = body.returnToColumnId || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("workspace_link_rules")
    .update(updates)
    .eq("id", ruleId)
    .eq("link_id", id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ rule: data });
}

export async function DELETE(_request: Request, ctxParams: Ctx) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { id, ruleId } = await ctxParams.params;
  const supabase = await createClient();

  const { data: link } = await supabase
    .from("workspace_links")
    .select("id")
    .eq("id", id)
    .eq("source_tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("workspace_link_rules")
    .delete()
    .eq("id", ruleId)
    .eq("link_id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
