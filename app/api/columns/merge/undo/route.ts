import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MergedFrom = {
  column: {
    name: string;
    kind: string;
    position: number;
    color: string | null;
    image_url: string | null;
    drop_in_roles: string[] | null;
    drop_out_roles: string[] | null;
    visible_to_roles: string[];
    visible_to_users: string[];
    visibility_mode: string;
    visibility_roles: string[];
    visibility_users_v2: string[];
  };
  orig_position: number;
};

/**
 * Undo a column merge. Finds every card tagged with specs.merged_from, recreates
 * each source column from the tag, moves the cards back to their original column
 * and position, and clears the tag. GET reports how many cards are pending undo.
 */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = await createClient();
  const { count } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenant.id)
    .not("specs->merged_from", "is", null);
  return NextResponse.json({ pending: count ?? 0 });
}

export async function POST() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const { data: rows, error } = await supabase
    .from("orders")
    .select("id, specs")
    .eq("tenant_id", tenantId)
    .not("specs->merged_from", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, restoredCount: 0, columns: [] });
  }

  // Group tagged cards by their original column name (one recreated column each).
  const groups = new Map<
    string,
    { snapshot: MergedFrom["column"]; cards: { id: string; pos: number; specs: Record<string, unknown> }[] }
  >();
  for (const r of rows) {
    const specs = (r.specs ?? {}) as Record<string, unknown>;
    const mf = specs.merged_from as MergedFrom | undefined;
    if (!mf?.column?.name) continue;
    const key = mf.column.name;
    const g = groups.get(key) ?? { snapshot: mf.column, cards: [] };
    g.cards.push({ id: r.id, pos: mf.orig_position ?? 0, specs });
    groups.set(key, g);
  }

  const now = new Date().toISOString();
  const restoredColumns: { name: string; id: string; cards: number }[] = [];
  let restoredCount = 0;

  for (const [, g] of groups) {
    const s = g.snapshot;
    // Reuse the original column if it still exists (e.g. a partial merge that
    // moved cards but couldn't delete it) so undo never leaves a duplicate.
    const { data: existingCol } = await supabase
      .from("board_columns")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("name", s.name)
      .limit(1)
      .maybeSingle();
    let newId: string;
    if (existingCol?.id) {
      newId = existingCol.id as string;
    } else {
      const { data: created, error: createErr } = await supabase
        .from("board_columns")
        .insert({
          tenant_id: tenantId,
          name: s.name,
          kind: s.kind,
          position: s.position,
          color: s.color,
          image_url: s.image_url,
          drop_in_roles: s.drop_in_roles,
          drop_out_roles: s.drop_out_roles,
          visible_to_roles: s.visible_to_roles ?? [],
          visible_to_users: s.visible_to_users ?? [],
          visibility_mode: s.visibility_mode ?? "all",
          visibility_roles: s.visibility_roles ?? [],
          visibility_users_v2: s.visibility_users_v2 ?? [],
        })
        .select("id")
        .single();
      if (createErr || !created) {
        return NextResponse.json(
          { error: `Failed to recreate column "${s.name}": ${createErr?.message}` },
          { status: 500 }
        );
      }
      newId = created.id as string;
    }
    for (const c of g.cards) {
      const rest = { ...c.specs };
      delete rest.merged_from;
      await supabase
        .from("orders")
        .update({ column_id: newId, position: c.pos, specs: rest, updated_at: now })
        .eq("id", c.id)
        .eq("tenant_id", tenantId);
      restoredCount++;
    }
    restoredColumns.push({ name: s.name, id: newId, cards: g.cards.length });
  }

  return NextResponse.json({ ok: true, restoredCount, columns: restoredColumns });
}
