import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isPrepressColumnName, rankPrepressQueue } from "@/lib/prepress-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANAGER_ROLES = new Set(["admin", "preprod_owner", "account_manager"]);

/**
 * Pre-press column queue.
 *   GET  → all open orders in Prepress columns, sorted like the board ranks
 *   PATCH { order_ids } → save drag order (managers only)
 */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();

  const { data: cols, error: colErr } = await supabase
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", ctx.tenant.id);
  if (colErr) return NextResponse.json({ error: colErr.message }, { status: 500 });

  const prepressColIds = (cols ?? [])
    .filter((c) => isPrepressColumnName(c.name as string))
    .map((c) => c.id as string);

  if (prepressColIds.length === 0) {
    return NextResponse.json({ orders: [], canAssign: MANAGER_ROLES.has(ctx.role) });
  }

  const { data, error } = await supabase
    .from("orders")
    .select("id, title, priority, due_date, specs, customer:customers(name)")
    .eq("tenant_id", ctx.tenant.id)
    .in("column_id", prepressColIds)
    .is("removed_at", null)
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ranked = rankPrepressQueue(
    (data ?? []).map((o) => {
      const specs = (o.specs ?? {}) as Record<string, unknown>;
      const posRaw = specs.prepress_queue_pos;
      const n = typeof posRaw === "number" ? posRaw : Number(posRaw);
      return {
        id: o.id as string,
        queuePos: Number.isFinite(n) ? n : null,
        priority: (o.priority as string) ?? "normal",
        dueDate: (o.due_date as string | null) ?? null,
      };
    })
  );

  const byId = new Map((data ?? []).map((o) => [o.id as string, o]));
  const orders = Object.entries(ranked)
    .sort((a, b) => a[1] - b[1])
    .map(([id, queue_pos]) => {
      const o = byId.get(id)!;
      return {
        id,
        title: (o.title as string) ?? "",
        priority: (o.priority as string) ?? "normal",
        due_date: (o.due_date as string | null) ?? null,
        queue_pos: queue_pos - 1,
        customer_name: ((o.customer as { name?: string } | null)?.name) ?? null,
      };
    });

  return NextResponse.json({ orders, canAssign: MANAGER_ROLES.has(ctx.role) });
}

export async function PATCH(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!MANAGER_ROLES.has(ctx.role)) {
    return NextResponse.json({ error: "Only a manager can set the queue." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { order_ids?: string[] };
  const ids = Array.isArray(body.order_ids) ? body.order_ids : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "order_ids is required." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("orders")
    .select("id, specs")
    .eq("tenant_id", ctx.tenant.id)
    .in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const specsById = new Map(
    (rows ?? []).map((r) => [r.id as string, (r.specs ?? {}) as Record<string, unknown>])
  );

  const now = new Date().toISOString();
  for (let i = 0; i < ids.length; i++) {
    const cur = specsById.get(ids[i]);
    if (!cur) continue;
    await supabase
      .from("orders")
      .update({ specs: { ...cur, prepress_queue_pos: i }, updated_at: now })
      .eq("id", ids[i])
      .eq("tenant_id", ctx.tenant.id);
  }

  return NextResponse.json({ ok: true, count: ids.length });
}
