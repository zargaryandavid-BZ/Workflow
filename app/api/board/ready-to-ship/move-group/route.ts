import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { listOrderGroupMembers } from "@/lib/ready-to-ship-group";
import { stopOpenTimersForOrder } from "@/lib/stop-order-timers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bring EVERY line item of an order into one column at once — used by the
 * Ready-to-Ship popup so staff don't have to drag 12 parts in one by one (each
 * of which popped the pickup/shipping window again). This is a plain, quiet
 * move: it repositions the sibling cards and stops their open timers, but does
 * NOT fire any customer notification — the single consolidated "ready" message
 * is still sent by the popup afterwards, once, for the whole group.
 *
 * POST { orderId, toColumnId } → { moved, movedIds, toColumnId }
 */
export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    orderId?: string;
    toColumnId?: string;
  };
  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  const toColumnId = typeof body.toColumnId === "string" ? body.toColumnId : "";
  if (!orderId || !toColumnId) {
    return NextResponse.json(
      { error: "orderId and toColumnId are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, title, column_id, description, specs")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (orderErr) {
    return NextResponse.json({ error: orderErr.message }, { status: 500 });
  }
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Confirm the target column belongs to this tenant.
  const { data: toColumn } = await supabase
    .from("board_columns")
    .select("id")
    .eq("id", toColumnId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!toColumn) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }

  const members = await listOrderGroupMembers(supabase, tenantId, {
    id: order.id as string,
    title: String(order.title ?? ""),
    column_id: order.column_id as string | null,
    description: order.description as string | null,
    specs: (order.specs ?? {}) as Record<string, unknown>,
  });

  const toMove = members.filter((m) => m.column_id !== toColumnId);
  if (toMove.length === 0) {
    return NextResponse.json({ moved: 0, movedIds: [], toColumnId });
  }

  // Append after whatever is already in the target column.
  const { data: existing } = await supabase
    .from("orders")
    .select("position")
    .eq("tenant_id", tenantId)
    .eq("column_id", toColumnId)
    .is("removed_at", null)
    .order("position", { ascending: false })
    .limit(1);
  let nextPos =
    (typeof existing?.[0]?.position === "number" ? existing[0].position : 0) + 1;

  const now = new Date().toISOString();
  const movedIds: string[] = [];
  for (const m of toMove) {
    const { error: upErr } = await supabase
      .from("orders")
      .update({
        column_id: toColumnId,
        position: nextPos,
        last_moved_at: now,
      })
      .eq("id", m.id)
      .eq("tenant_id", tenantId);
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
    // Work done on this part — stop any running timers, same as a normal move.
    try {
      await stopOpenTimersForOrder(tenantId, m.id);
    } catch {
      /* non-critical */
    }
    movedIds.push(m.id);
    nextPos += 1;
  }

  return NextResponse.json({ moved: movedIds.length, movedIds, toColumnId });
}
