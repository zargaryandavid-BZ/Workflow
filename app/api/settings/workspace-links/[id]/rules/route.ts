import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

async function assertOwnedLink(linkId: string, tenantId: string) {
  const supabase = await createClient();
  const { data: link } = await supabase
    .from("workspace_links")
    .select("id, source_tenant_id, target_tenant_id")
    .eq("id", linkId)
    .eq("source_tenant_id", tenantId)
    .maybeSingle();
  return { supabase, link };
}

/** List rules for a link; also returns source + target columns for the UI. */
export async function GET(_request: Request, ctxParams: Ctx) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { id } = await ctxParams.params;
  const { supabase, link } = await assertOwnedLink(id, ctx.tenant.id);
  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  const [{ data: rules }, { data: sourceColumns }] = await Promise.all([
    supabase
      .from("workspace_link_rules")
      .select("*")
      .eq("link_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("board_columns")
      .select("id, name, position")
      .eq("tenant_id", ctx.tenant.id)
      .order("position", { ascending: true }),
  ]);

  const admin = createAdminClient();
  const { data: targetColumns } = await admin
    .from("board_columns")
    .select("id, name, position")
    .eq("tenant_id", link.target_tenant_id)
    .order("position", { ascending: true });

  return NextResponse.json({
    rules: rules ?? [],
    sourceColumns: sourceColumns ?? [],
    targetColumns: targetColumns ?? [],
  });
}

/** Create a mirror rule on this link. */
export async function POST(request: Request, ctxParams: Ctx) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { id } = await ctxParams.params;
  const { supabase, link } = await assertOwnedLink(id, ctx.tenant.id);
  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    triggerColumnId?: string;
    mirrorStartColumnId?: string;
    returnColumnId?: string | null;
    returnToColumnId?: string | null;
  };

  if (!body.triggerColumnId || !body.mirrorStartColumnId) {
    return NextResponse.json(
      { error: "triggerColumnId and mirrorStartColumnId are required" },
      { status: 400 }
    );
  }

  // Validate columns belong to the right tenants.
  const admin = createAdminClient();
  const [{ data: triggerCol }, { data: startCol }] = await Promise.all([
    supabase
      .from("board_columns")
      .select("id")
      .eq("id", body.triggerColumnId)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle(),
    admin
      .from("board_columns")
      .select("id")
      .eq("id", body.mirrorStartColumnId)
      .eq("tenant_id", link.target_tenant_id)
      .maybeSingle(),
  ]);
  if (!triggerCol) {
    return NextResponse.json(
      { error: "Trigger column must belong to this workspace" },
      { status: 400 }
    );
  }
  if (!startCol) {
    return NextResponse.json(
      { error: "Mirror start column must belong to the linked workspace" },
      { status: 400 }
    );
  }

  if (body.returnColumnId) {
    const { data: retCol } = await admin
      .from("board_columns")
      .select("id")
      .eq("id", body.returnColumnId)
      .eq("tenant_id", link.target_tenant_id)
      .maybeSingle();
    if (!retCol) {
      return NextResponse.json(
        { error: "Return column must belong to the linked workspace" },
        { status: 400 }
      );
    }
  }
  if (body.returnToColumnId) {
    const { data: retTo } = await supabase
      .from("board_columns")
      .select("id")
      .eq("id", body.returnToColumnId)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle();
    if (!retTo) {
      return NextResponse.json(
        { error: "Return-to column must belong to this workspace" },
        { status: 400 }
      );
    }
  }

  const { data, error } = await supabase
    .from("workspace_link_rules")
    .insert({
      link_id: id,
      trigger_column_id: body.triggerColumnId,
      mirror_start_column_id: body.mirrorStartColumnId,
      return_column_id: body.returnColumnId || null,
      return_to_column_id: body.returnToColumnId || null,
      enabled: true,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ rule: data });
}
