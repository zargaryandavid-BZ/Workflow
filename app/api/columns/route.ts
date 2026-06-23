import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { sanitizeDropRoles, sanitizeVisibleToRoles, sanitizeVisibleToUsers } from "@/lib/columns";
import { normalizeVisibilityMode } from "@/lib/check-visibility";

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    kind?: string;
    color?: string | null;
    imageUrl?: string | null;
    dropInRoles?: unknown;
    dropOutRoles?: unknown;
    visibleToRoles?: unknown;
    visibleToUsers?: unknown;
    visibilityMode?: string;
    visibilityRoles?: string[];
    visibilityUsersV2?: string[];
  };
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("board_columns")
    .select("position")
    .eq("tenant_id", ctx.tenant.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last as { position: number } | null)?.position ?? -1) + 1;

  const visibilityMode = normalizeVisibilityMode(body.visibilityMode);

  const { data, error } = await supabase
    .from("board_columns")
    .insert({
      tenant_id: ctx.tenant.id,
      name: body.name.trim(),
      kind: body.kind ?? "normal",
      color: body.color ?? null,
      image_url: body.imageUrl ?? null,
      drop_in_roles: sanitizeDropRoles(body.dropInRoles),
      drop_out_roles: sanitizeDropRoles(body.dropOutRoles),
      visible_to_roles: sanitizeVisibleToRoles(body.visibleToRoles),
      visible_to_users: sanitizeVisibleToUsers(body.visibleToUsers),
      visibility_mode: visibilityMode,
      visibility_roles: body.visibilityRoles ?? [],
      visibility_users_v2: body.visibilityUsersV2 ?? [],
      position,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ column: data });
}
