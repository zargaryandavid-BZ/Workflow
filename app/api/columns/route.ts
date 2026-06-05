import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { sanitizeDropRoles } from "@/lib/columns";

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
      position,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ column: data });
}
