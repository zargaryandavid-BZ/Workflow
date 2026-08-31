import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Merge one column INTO another (e.g. In Progress → Start).
 *
 * Fully reversible: every moved card records, in its own specs.merged_from, the
 * source column's full definition and the card's original position. The source
 * column is then deleted. `/api/columns/merge/undo` reads those tags to recreate
 * the column and move each card back — no separate backup table needed.
 *
 * POST { fromColumnId, toColumnId }  (admin only)
 */
export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    fromColumnId?: string;
    toColumnId?: string;
  };
  const fromId = typeof body.fromColumnId === "string" ? body.fromColumnId : "";
  const toId = typeof body.toColumnId === "string" ? body.toColumnId : "";
  if (!fromId || !toId || fromId === toId) {
    return NextResponse.json(
      { error: "fromColumnId and a different toColumnId are required." },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  // Snapshot both columns (full definition of the one being removed).
  const { data: cols, error: colErr } = await supabase
    .from("board_columns")
    .select(
      "id, name, kind, position, color, image_url, drop_in_roles, drop_out_roles, visible_to_roles, visible_to_users, visibility_mode, visibility_roles, visibility_users_v2"
    )
    .eq("tenant_id", tenantId)
    .in("id", [fromId, toId]);
  if (colErr) return NextResponse.json({ error: colErr.message }, { status: 500 });
  const fromCol = (cols ?? []).find((c) => c.id === fromId);
  const toCol = (cols ?? []).find((c) => c.id === toId);
  if (!fromCol || !toCol) {
    return NextResponse.json({ error: "Column not found." }, { status: 404 });
  }

  // The card-level backup blob (same for every moved card).
  const columnSnapshot = {
    id: fromCol.id,
    name: fromCol.name,
    kind: fromCol.kind,
    position: fromCol.position,
    color: fromCol.color,
    image_url: fromCol.image_url,
    drop_in_roles: fromCol.drop_in_roles,
    drop_out_roles: fromCol.drop_out_roles,
    visible_to_roles: fromCol.visible_to_roles,
    visible_to_users: fromCol.visible_to_users,
    visibility_mode: fromCol.visibility_mode,
    visibility_roles: fromCol.visibility_roles,
    visibility_users_v2: fromCol.visibility_users_v2,
  };

  // All live cards in the source column.
  const { data: rows, error: rowsErr } = await supabase
    .from("orders")
    .select("id, position, specs")
    .eq("tenant_id", tenantId)
    .eq("column_id", fromId)
    .is("removed_at", null);
  if (rowsErr) return NextResponse.json({ error: rowsErr.message }, { status: 500 });

  const beforeFrom = rows?.length ?? 0;
  const { count: beforeToCount } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("column_id", toId)
    .is("removed_at", null);
  const beforeTo = beforeToCount ?? 0;

  const now = new Date().toISOString();
  for (const r of rows ?? []) {
    const specs = (r.specs ?? {}) as Record<string, unknown>;
    await supabase
      .from("orders")
      .update({
        column_id: toId,
        specs: {
          ...specs,
          merged_from: {
            column: columnSnapshot,
            orig_position: r.position,
            merged_at: now,
          },
        },
        updated_at: now,
      })
      .eq("id", r.id)
      .eq("tenant_id", tenantId);
  }

  // Verify every card landed before removing the source column.
  const { count: afterToCount } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("column_id", toId)
    .is("removed_at", null);
  const afterTo = afterToCount ?? 0;
  if (afterTo !== beforeTo + beforeFrom) {
    return NextResponse.json(
      {
        error:
          "Card count mismatch after move — source column left intact, nothing deleted.",
        beforeFrom,
        beforeTo,
        afterTo,
      },
      { status: 500 }
    );
  }

  // FK is ON DELETE RESTRICT, so this only succeeds once the column is empty.
  const { error: delErr } = await supabase
    .from("board_columns")
    .delete()
    .eq("id", fromId)
    .eq("tenant_id", tenantId);
  if (delErr) {
    return NextResponse.json(
      { error: `Cards moved, but removing the column failed: ${delErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    movedCount: beforeFrom,
    fromColumnName: fromCol.name,
    toColumnName: toCol.name,
    afterToCount: afterTo,
  });
}
