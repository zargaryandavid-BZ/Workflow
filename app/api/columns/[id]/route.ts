import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { sanitizeDropRoles } from "@/lib/columns";

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
    kind?: string;
    color?: string | null;
    imageUrl?: string | null;
    dropInRoles?: unknown;
    dropOutRoles?: unknown;
  };

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.kind !== undefined) updates.kind = body.kind;
  if (body.color !== undefined) updates.color = body.color;
  if (body.imageUrl !== undefined) updates.image_url = body.imageUrl;
  if (body.dropInRoles !== undefined)
    updates.drop_in_roles = sanitizeDropRoles(body.dropInRoles);
  if (body.dropOutRoles !== undefined)
    updates.drop_out_roles = sanitizeDropRoles(body.dropOutRoles);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("board_columns")
    .update(updates)
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ column: data });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const moveTo = searchParams.get("moveTo");

  const supabase = await createClient();

  // Don't allow deleting the last column.
  const { count: totalColumns } = await supabase
    .from("board_columns")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenant.id);
  if ((totalColumns ?? 0) <= 1) {
    return NextResponse.json(
      { error: "You must keep at least one column." },
      { status: 400 }
    );
  }

  // How many orders live in this column?
  const { count: orderCount } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("column_id", id);

  if ((orderCount ?? 0) > 0) {
    if (!moveTo) {
      // Tell the client there are orders that must be relocated first.
      return NextResponse.json(
        { error: "orders_present", orderCount: orderCount ?? 0 },
        { status: 409 }
      );
    }
    if (moveTo === id) {
      return NextResponse.json(
        { error: "Choose a different destination column." },
        { status: 400 }
      );
    }
    const { error: moveError } = await supabase
      .from("orders")
      .update({ column_id: moveTo })
      .eq("column_id", id)
      .eq("tenant_id", ctx.tenant.id);
    if (moveError) {
      return NextResponse.json({ error: moveError.message }, { status: 400 });
    }
  }

  const { error } = await supabase
    .from("board_columns")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
