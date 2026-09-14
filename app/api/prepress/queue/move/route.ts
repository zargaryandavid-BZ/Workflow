import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isPrepressColumnName, rankPrepressQueue } from "@/lib/prepress-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANAGER_ROLES = new Set(["admin", "preprod_owner", "account_manager"]);

function queuePos(specs: unknown): number {
  const v = (specs as { prepress_queue_pos?: unknown } | null)
    ?.prepress_queue_pos;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/**
 * Move one Prepress card to a 1-based position and renumber the queue.
 * PATCH { order_id, position } → { ok, posById }
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
  const { data: cols, error: colErr } = await supabase
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", ctx.tenant.id);
  if (colErr) return NextResponse.json({ error: colErr.message }, { status: 500 });

  const prepressColIds = (cols ?? [])
    .filter((c) => isPrepressColumnName(c.name as string))
    .map((c) => c.id as string);
  if (prepressColIds.length === 0) {
    return NextResponse.json({ error: "No Prepress column found." }, { status: 500 });
  }

  const { data: rows, error } = await supabase
    .from("orders")
    .select("id, priority, due_date, specs")
    .eq("tenant_id", ctx.tenant.id)
    .in("column_id", prepressColIds)
    .is("removed_at", null)
    .limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ranked = rankPrepressQueue(
    (rows ?? []).map((r) => {
      const specs = (r.specs ?? {}) as Record<string, unknown>;
      const posRaw = specs.prepress_queue_pos;
      const n = typeof posRaw === "number" ? posRaw : Number(posRaw);
      return {
        id: r.id as string,
        queuePos: Number.isFinite(n) ? n : null,
        priority: (r.priority as string) ?? "normal",
        dueDate: (r.due_date as string | null) ?? null,
      };
    })
  );

  const byId = new Map(
    (rows ?? []).map((r) => [
      r.id as string,
      {
        id: r.id as string,
        specs: (r.specs ?? {}) as Record<string, unknown>,
      },
    ])
  );

  const ordered = Object.entries(ranked)
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => byId.get(id)!)
    .filter(Boolean);

  const from = ordered.findIndex((o) => o.id === orderId);
  if (from === -1) {
    return NextResponse.json(
      { error: "Card not found in Prepress queue." },
      { status: 404 }
    );
  }

  const to = Math.max(0, Math.min(ordered.length - 1, Math.floor(rawPos) - 1));
  const [card] = ordered.splice(from, 1);
  ordered.splice(to, 0, card);

  const now = new Date().toISOString();
  const posById: Record<string, number> = {};
  for (let i = 0; i < ordered.length; i++) {
    posById[ordered[i].id] = i;
    if (queuePos(ordered[i].specs) === i) continue;
    await supabase
      .from("orders")
      .update({
        specs: { ...ordered[i].specs, prepress_queue_pos: i },
        updated_at: now,
      })
      .eq("id", ordered[i].id)
      .eq("tenant_id", ctx.tenant.id);
  }

  return NextResponse.json({ ok: true, posById });
}
