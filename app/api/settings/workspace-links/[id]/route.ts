import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

async function loadOwnedLink(linkId: string, tenantId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_links")
    .select("*")
    .eq("id", linkId)
    .eq("source_tenant_id", tenantId)
    .maybeSingle();
  return { supabase, link: data, error };
}

/** Update enabled flag on a link owned by this tenant (as source). */
export async function PATCH(request: Request, ctxParams: Ctx) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { id } = await ctxParams.params;
  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean;
  };

  const { supabase, link, error: loadErr } = await loadOwnedLink(
    id,
    ctx.tenant.id
  );
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") updates.enabled = body.enabled;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("workspace_links")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ link: data });
}

export async function DELETE(_request: Request, ctxParams: Ctx) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { id } = await ctxParams.params;
  const { supabase, link, error: loadErr } = await loadOwnedLink(
    id,
    ctx.tenant.id
  );
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  const { error } = await supabase.from("workspace_links").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
