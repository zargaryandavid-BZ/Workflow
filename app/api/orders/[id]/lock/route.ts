import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { logActivity } from "@/lib/automation";

/**
 * Order lock.
 *   POST   /api/orders/[id]/lock  { reason }  → freeze the card (any member).
 *   DELETE /api/orders/[id]/lock             → unlock (admin OR the person who locked it).
 * A locked card can't be opened/edited by anyone else until it is unlocked.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { reason?: string };
  const reason = String(body.reason ?? "").trim();
  if (!reason) {
    return NextResponse.json({ error: "A reason is required to lock a card." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("id, tenant_id, locked_by, locked_by_name")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // Already locked by someone else → do not silently override.
  if (order.locked_by && order.locked_by !== ctx.userId) {
    return NextResponse.json(
      { error: `Already locked by ${order.locked_by_name ?? "another team member"}.` },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("orders")
    .update({
      locked_by: ctx.userId,
      locked_by_name: ctx.fullName ?? "Team member",
      lock_reason: reason,
      locked_at: now,
      updated_at: now,
    })
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .select("id, locked_by, locked_by_name, lock_reason, locked_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity(supabase, {
    tenantId: ctx.tenant.id,
    orderId,
    actor: ctx.userId,
    action: "order_locked",
    metadata: { reason, by: ctx.fullName ?? null },
  });

  return NextResponse.json({ ok: true, order: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("id, tenant_id, locked_by, locked_by_name, lock_reason")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (!order.locked_by) return NextResponse.json({ ok: true }); // already unlocked

  const isAdmin = ctx.role === "admin";
  const isLocker = order.locked_by === ctx.userId;
  if (!isAdmin && !isLocker) {
    return NextResponse.json(
      { error: `Only ${order.locked_by_name ?? "the person who locked it"} or an admin can unlock this card.` },
      { status: 403 },
    );
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("orders")
    .update({ locked_by: null, locked_by_name: null, lock_reason: null, locked_at: null, updated_at: now })
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity(supabase, {
    tenantId: ctx.tenant.id,
    orderId,
    actor: ctx.userId,
    action: "order_unlocked",
    metadata: { previously_locked_by: order.locked_by_name ?? null },
  });

  return NextResponse.json({ ok: true });
}
