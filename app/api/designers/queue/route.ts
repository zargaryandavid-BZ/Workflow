import { NextResponse } from "next/server";
import {
  DESIGNER_QUEUE_MANUAL_KEY,
  orderDesignerQueue,
  queueInputFromRow,
} from "@/lib/designer-queue-rank";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadTeamMembers } from "@/lib/team-members";
import { isDesignerStartColumnName } from "@/lib/designer-queue-columns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANAGER_ROLES = new Set(["admin", "preprod_owner", "account_manager"]);
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function queuePos(specs: unknown): number {
  const v = (specs as { designer_queue_pos?: unknown } | null)?.designer_queue_pos;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/**
 * Designer work queue.
 *   GET                    → { designers } for the picker (managers/admin only)
 *   GET ?designer_id=X     → X's open cards in manager-set queue order
 *   PATCH { designer_id, order_ids } → save the queue order (managers/admin only)
 */
export async function GET(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const isManager = MANAGER_ROLES.has(ctx.role);
  const designerId = new URL(request.url).searchParams.get("designer_id");

  if (!designerId) {
    if (!isManager) {
      // A designer only ever sees their own queue.
      return NextResponse.json({ designers: [{ id: ctx.userId, name: "You" }], self: ctx.userId, canAssign: false });
    }
    const { members } = await loadTeamMembers(ctx.tenant.id);
    const designers = (members ?? [])
      .filter((m) => m.role === "designer")
      .map((m) => ({
        id: m.user_id,
        name:
          m.profile?.full_name?.trim() ||
          m.email?.split("@")[0]?.trim() ||
          "Designer",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ designers, self: ctx.userId, canAssign: isManager });
  }

  if (!isManager && designerId !== ctx.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();

  // Resolve Start-column IDs — the queue shows only cards waiting in the
  // Start column. Cards that have moved to In Progress or beyond are removed.
  const { data: cols } = await supabase
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", ctx.tenant.id);
  const startColumnIds = (cols ?? [])
    .filter((c: { name: string | null }) => isDesignerStartColumnName(c.name))
    .map((c: { id: string }) => c.id);

  if (startColumnIds.length === 0) {
    return NextResponse.json({ orders: [] });
  }

  const { data, error } = await supabase
    .from("orders")
    .select("id, title, priority, due_date, specs, column_id, last_moved_at, created_at, customer:customers(name)")
    .eq("tenant_id", ctx.tenant.id)
    .eq("specs->>designer_id", designerId)
    .in("column_id", startColumnIds)
    .is("removed_at", null)
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Same order as the board (rush → longest in column, manual slots kept).
  const rows = (data ?? []) as Array<Record<string, unknown> & { id: string }>;
  const rowById = new Map(rows.map((o) => [o.id, o]));
  const orders = orderDesignerQueue(
    rows.map((o) =>
      queueInputFromRow(o as Parameters<typeof queueInputFromRow>[0])
    )
  ).map((c) => {
    const o = rowById.get(c.id)!;
    return {
      id: o.id,
      title: (o.title as string) ?? "",
      priority: (o.priority as string) ?? "normal",
      due_date: (o.due_date as string | null) ?? null,
      queue_pos: queuePos(o.specs),
      customer_name: ((o.customer as { name?: string } | null)?.name) ?? null,
    };
  });

  return NextResponse.json({ orders });
}

export async function PATCH(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!MANAGER_ROLES.has(ctx.role)) {
    return NextResponse.json({ error: "Only a manager can set the queue." }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    designer_id?: string;
    order_ids?: string[];
  };
  const ids = Array.isArray(body.order_ids) ? body.order_ids : [];
  if (!body.designer_id || ids.length === 0) {
    return NextResponse.json({ error: "designer_id and order_ids are required." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("orders")
    .select("id, specs")
    .eq("tenant_id", ctx.tenant.id)
    .in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const specsById = new Map((rows ?? []).map((r) => [r.id as string, (r.specs ?? {}) as Record<string, unknown>]));

  const now = new Date().toISOString();
  for (let i = 0; i < ids.length; i++) {
    const cur = specsById.get(ids[i]);
    if (!cur) continue;
    // Already at this slot → skip the write (fewer realtime refetches).
    // Manager saved this exact order → every card is placed by hand.
    if (queuePos(cur) === i && cur[DESIGNER_QUEUE_MANUAL_KEY] === true) continue;
    await supabase
      .from("orders")
      .update({
        specs: { ...cur, designer_queue_pos: i, [DESIGNER_QUEUE_MANUAL_KEY]: true },
        updated_at: now,
      })
      .eq("id", ids[i])
      .eq("tenant_id", ctx.tenant.id);
  }
  return NextResponse.json({ ok: true, count: ids.length });
}
