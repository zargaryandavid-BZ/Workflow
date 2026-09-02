import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { logActivity } from "@/lib/automation";

/**
 * Record WHY a card was put on hold. Logged as a `hold_reason` activity so it
 * shows in the card's activity timeline right under the "→ Hold" move line
 * (and reads back in the notes/activity panel). Kept as an activity entry only
 * — no destructive write to the order.
 *
 * POST { reason }  ->  { ok }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    reason?: unknown;
    columnName?: unknown;
  };
  const reason =
    typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!reason) {
    return NextResponse.json({ error: "A reason is required." }, { status: 400 });
  }
  const columnName =
    typeof body.columnName === "string" ? body.columnName.trim().slice(0, 120) : "";

  const supabase = await createClient();

  // Confirm the order is in this tenant before logging against it.
  const { data: order, error: loadError } = await supabase
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await logActivity(supabase, {
    tenantId: ctx.tenant.id,
    orderId,
    actor: ctx.userId,
    action: "hold_reason",
    metadata: { reason, ...(columnName ? { columnName } : {}) },
  });

  return NextResponse.json({ ok: true });
}
