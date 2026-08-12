import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** List workspace links where this tenant is source or target. */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const { data: links, error } = await supabase
    .from("workspace_links")
    .select(
      "id, source_tenant_id, target_tenant_id, enabled, created_at, workspace_link_rules(*)"
    )
    .or(`source_tenant_id.eq.${tenantId},target_tenant_id.eq.${tenantId}`)
    .order("created_at", { ascending: false });

  if (error) {
    if (/workspace_links|does not exist/i.test(error.message)) {
      return NextResponse.json({
        links: [],
        migrationRequired: true,
        partnerOptions: [],
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Partners the user can link to (other tenants where they are admin).
  const memberships = ctx.memberships ?? [];
  const partnerIds = memberships
    .filter((m) => m.tenant_id !== tenantId && m.role === "admin")
    .map((m) => m.tenant_id);

  let partnerOptions: { id: string; name: string }[] = [];
  if (partnerIds.length > 0) {
    const admin = createAdminClient();
    const { data: tenants } = await admin
      .from("tenants")
      .select("id, name")
      .in("id", partnerIds);
    partnerOptions = (tenants ?? []) as { id: string; name: string }[];
  }

  // Resolve tenant names for existing links.
  const linkTenantIds = [
    ...new Set(
      (links ?? []).flatMap((l) => [
        l.source_tenant_id as string,
        l.target_tenant_id as string,
      ])
    ),
  ];
  const nameById = new Map<string, string>();
  nameById.set(tenantId, ctx.tenant.name);
  if (linkTenantIds.length > 0) {
    const admin = createAdminClient();
    const { data: tenants } = await admin
      .from("tenants")
      .select("id, name")
      .in("id", linkTenantIds);
    for (const t of tenants ?? []) {
      nameById.set(t.id as string, t.name as string);
    }
  }

  return NextResponse.json({
    links: (links ?? []).map((l) => ({
      ...l,
      source_tenant_name: nameById.get(l.source_tenant_id as string) ?? "Unknown",
      target_tenant_name: nameById.get(l.target_tenant_id as string) ?? "Unknown",
      rules: l.workspace_link_rules ?? [],
    })),
    migrationRequired: false,
    partnerOptions,
  });
}

/** Create a workspace link (this tenant = source). */
export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    targetTenantId?: string;
  };
  if (!body.targetTenantId) {
    return NextResponse.json(
      { error: "targetTenantId is required" },
      { status: 400 }
    );
  }
  if (body.targetTenantId === ctx.tenant.id) {
    return NextResponse.json(
      { error: "Cannot link a workspace to itself" },
      { status: 400 }
    );
  }

  const isPartnerAdmin = (ctx.memberships ?? []).some(
    (m) => m.tenant_id === body.targetTenantId && m.role === "admin"
  );
  if (!isPartnerAdmin) {
    return NextResponse.json(
      { error: "You must be an admin of the target workspace to link it" },
      { status: 403 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_links")
    .insert({
      source_tenant_id: ctx.tenant.id,
      target_tenant_id: body.targetTenantId,
      enabled: true,
      created_by: ctx.userId,
    })
    .select("*")
    .single();

  if (error) {
    if (/unique|duplicate/i.test(error.message)) {
      return NextResponse.json(
        { error: "A link to that workspace already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ link: data });
}
