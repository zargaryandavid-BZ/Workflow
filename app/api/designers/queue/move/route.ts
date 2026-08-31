import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isDesignerQueueColumnName } from "@/lib/designer-queue-columns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANAGER_ROLES = new Set(["admin", "preprod_owner", "account_manager"]);
const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function queuePos(specs: unknown): number {
  const v = (specs as { designer_queue_pos?: unknown } | null)?.designer_queue_pos;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/**
 * Move ONE card to a 1-based position within its designer's queue and renumber
 * that designer's open cards contiguously (0-based designer_queue_pos).
 *
 * PATCH { order_id, position }  (managers/admin only)
 *   → { ok, designer_id, posById }  where posById is order_id → new 0-based pos.
 */
export async function PATCH(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!MANAGER_ROLES.has(ctx.role)) {
    return NextResponse.json(
      { error: "Only a manager can set the queue." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    order_id?: string;
    position?: number;
  };
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  const rawPos = Number(body.position);
  if (!orderId || !Number.isFinite(rawPos)) {
    return NextResponse.json(
      { error: "order_id and position are required." },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  // Which designer does the moved card belong to?
  const { data: moved, error: movedErr } = await supabase
    .from("orders")
    .select("id, specs")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (movedErr) {
    return NextResponse.json({ error: movedErr.message }, { status: 500 });
  }
  const designerId = String(
    (moved?.specs as { designer_id?: unknown } | null)?.designer_id ?? ""
  );
  if (!moved || !designerId) {
    return NextResponse.json(
      { error: "Card has no designer assigned." },
      { status: 400 }
    );
  }

  // The queue is only the Start + In Progress columns.
  const { data: cols, error: colErr } = await supabase
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", ctx.tenant.id);
  if (colErr) return NextResponse.json({ error: colErr.message }, { status: 500 });
  const queueColumnIds = (cols ?? [])
    .filter((c) => isDesignerQueueColumnName(c.name as string))
    .map((c) => c.id as string);
  if (queueColumnIds.length === 0) {
    return NextResponse.json(
      { error: "No Start / In Progress columns found." },
      { status: 500 }
    );
  }

  // That designer's open cards in the queue columns, in current order.
  const { data: rows, error } = await supabase
    .from("orders")
    .select("id, priority, due_date, specs")
    .eq("tenant_id", ctx.tenant.id)
    .eq("specs->>designer_id", designerId)
    .in("column_id", queueColumnIds)
    .is("removed_at", null)
    .limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ordered = (rows ?? [])
    .map((r) => ({
      id: r.id as string,
      specs: (r.specs ?? {}) as Record<string, unknown>,
      pos: queuePos(r.specs),
      priority: (r.priority as string) ?? "normal",
      due: (r.due_date as string | null) ?? "9999",
    }))
    .sort((a, b) => {
      if (a.pos !== b.pos) return a.pos - b.pos;
      const pr =
        (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
      if (pr !== 0) return pr;
      return a.due.localeCompare(b.due);
    });

  const from = ordered.findIndex((o) => o.id === orderId);
  if (from === -1) {
    return NextResponse.json(
      { error: "Card not found in designer queue." },
      { status: 404 }
    );
  }

  // Clamp target into range, then splice the card into its new slot.
  const to = Math.max(0, Math.min(ordered.length - 1, Math.floor(rawPos) - 1));
  const [card] = ordered.splice(from, 1);
  ordered.splice(to, 0, card);

  // Renumber contiguously; only write rows whose position actually changed.
  const now = new Date().toISOString();
  const posById: Record<string, number> = {};
  for (let i = 0; i < ordered.length; i++) {
    posById[ordered[i].id] = i;
    if (queuePos(ordered[i].specs) === i) continue;
    await supabase
      .from("orders")
      .update({
        specs: { ...ordered[i].specs, designer_queue_pos: i },
        updated_at: now,
      })
      .eq("id", ordered[i].id)
      .eq("tenant_id", ctx.tenant.id);
  }

  return NextResponse.json({ ok: true, designer_id: designerId, posById });
}
