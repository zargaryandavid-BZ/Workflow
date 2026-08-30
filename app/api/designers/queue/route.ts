import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadTeamMembers } from "@/lib/team-members";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANAGER_ROLES = new Set(["admin", "preprod_owner", "account_manager"]);
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function queuePos(specs: unknown): number {
  const v = (specs as { designer_queue_pos?: unknown } | null)?.designer_queue_pos;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

type QueueRow = {
  id: string;
  title: string;
  customer: string | null;
  priority: string;
  priority_score: number | null;
  spec: string | null;
  due_label: string | null;
  due_date: string | null;
  queue_pos: number;
};

function sortQueue(a: QueueRow, b: QueueRow): number {
  if (a.queue_pos !== b.queue_pos) return a.queue_pos - b.queue_pos;
  const pr = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
  if (pr !== 0) return pr;
  return (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
}

type OrderRow = {
  id: string;
  title: string | null;
  priority: string | null;
  due_date: string | null;
  specs: unknown;
  customer?: { name?: string | null } | { name?: string | null }[] | null;
};

// Same fields the board card reads — from the order row + specs, so the queue
// shows the SAME card, we only add the rank number. No custom-field lookups.
function toQueueRow(o: OrderRow): QueueRow {
  const specs = (o.specs ?? {}) as Record<string, unknown>;
  const cust = Array.isArray(o.customer) ? o.customer[0] : o.customer;
  const stock = typeof specs.stock === "string" ? specs.stock.trim() : "";
  const qty = typeof specs.quantity === "number" ? specs.quantity : null;
  const skuCount = Array.isArray(specs.skus) ? specs.skus.length : 0;
  const specParts = [
    stock || null,
    qty != null ? `qty ${qty}` : null,
    skuCount > 0 ? `${skuCount} SKU` : null,
  ].filter(Boolean) as string[];
  const scoreRaw = specs.priority_score;
  const score =
    typeof scoreRaw === "number" && scoreRaw >= 1 && scoreRaw <= 5 ? scoreRaw : null;
  return {
    id: o.id,
    title: (o.title as string) ?? "",
    customer: cust?.name?.trim() || null,
    priority: (o.priority as string) ?? "normal",
    priority_score: score,
    spec: specParts.length ? specParts.join(" · ") : null,
    due_label: typeof specs.due_date_label === "string" ? specs.due_date_label : null,
    due_date: (o.due_date as string | null) ?? null,
    queue_pos: queuePos(o.specs),
  };
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
  const url = new URL(request.url);
  const designerId = url.searchParams.get("designer_id");
  const wantAll = url.searchParams.get("all") === "1";

  // Manager cross-designer view: every designer + their ordered cards in ONE
  // payload, so Rafael sees all #1s, then all #2s, at a glance.
  if (wantAll) {
    if (!isManager) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { members } = await loadTeamMembers(ctx.tenant.id);
    const designerList = (members ?? [])
      .filter((m) => m.role === "designer")
      .map((m) => ({
        id: m.user_id,
        name:
          m.profile?.full_name?.trim() ||
          m.email?.split("@")[0]?.trim() ||
          "Designer",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("orders")
      .select("id, title, priority, due_date, specs, column_id, customer:customers(name)")
      .eq("tenant_id", ctx.tenant.id)
      .not("specs->>designer_id", "is", null)
      .is("removed_at", null)
      .limit(4000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const byDesigner = new Map<string, QueueRow[]>();
    for (const o of data ?? []) {
      const did = String((o.specs as { designer_id?: unknown } | null)?.designer_id ?? "");
      if (!did) continue;
      const list = byDesigner.get(did) ?? [];
      list.push(toQueueRow(o as OrderRow));
      byDesigner.set(did, list);
    }

    const designers = designerList.map((d) => ({
      ...d,
      orders: (byDesigner.get(d.id) ?? []).sort(sortQueue),
    }));
    return NextResponse.json({ designers, self: ctx.userId, canAssign: true });
  }

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
  const { data, error } = await supabase
    .from("orders")
    .select("id, title, priority, due_date, specs, column_id, customer:customers(name)")
    .eq("tenant_id", ctx.tenant.id)
    .eq("specs->>designer_id", designerId)
    .is("removed_at", null)
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const orders = (data ?? []).map((o) => toQueueRow(o as OrderRow)).sort(sortQueue);

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
    await supabase
      .from("orders")
      .update({ specs: { ...cur, designer_queue_pos: i }, updated_at: now })
      .eq("id", ids[i])
      .eq("tenant_id", ctx.tenant.id);
  }
  return NextResponse.json({ ok: true, count: ids.length });
}
