import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { canViewDieOrder } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { markOrderedDieReceived } from "@/lib/dies.server";

/**
 * POST /api/die-requests/[id]/received
 * Body: { undo?: boolean }
 *
 * Marks an ordered die as arrived at the shop (stops the overdue alarm), or
 * with `undo: true` puts it back to ordered. Nothing is sent to anyone.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canViewDieOrder(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { undo?: boolean };
  const undo = body.undo === true;

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("die_requests")
    .select("id, status, die_id")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const from = undo ? "received" : "ordered";
  if (existing.status !== from) {
    return NextResponse.json(
      {
        error: undo
          ? "This die isn't marked as received."
          : existing.status === "received"
            ? "This die is already marked as received."
            : "Confirm the order with the manufacturer before marking it received.",
      },
      { status: 409 }
    );
  }

  const receivedAt = undo ? null : new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("die_requests")
    .update({
      status: undo ? "ordered" : "received",
      received_at: receivedAt,
      received_by: undo ? null : ctx.userId,
    })
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", from)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        error: /received|status_check|check constraint/i.test(error.message)
          ? "Run migration 0092_die_request_received.sql in Supabase, then try again."
          : error.message,
      },
      { status: 400 }
    );
  }
  if (!updated) {
    return NextResponse.json(
      { error: "Someone else just changed this request. Refresh and try again." },
      { status: 409 }
    );
  }
  // The ordered die now joins the Dies tab (history: "Die received").
  const dieId = (existing as { die_id?: string | null }).die_id;
  if (dieId && !undo) {
    await markOrderedDieReceived(supabase, {
      tenantId: ctx.tenant.id,
      dieId,
      actor: { id: ctx.userId, name: ctx.fullName || ctx.email },
    });
  }
  return NextResponse.json({ ok: true, status: undo ? "ordered" : "received", receivedAt });
}
