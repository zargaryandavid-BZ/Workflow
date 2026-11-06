import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { useOrReturnDie } from "@/lib/dies.server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST { action: "use" | "return", note? } — any signed-in staff member.
 * Use: takes the die (counts one use). Return: hands it back.
 * Who and when go into the die's history.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    note?: string;
    uses?: unknown;
    order_id?: unknown;
    qty?: unknown;
  };
  if (body.action !== "use" && body.action !== "return") {
    return NextResponse.json({ error: "action must be use or return" }, { status: 422 });
  }
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) || null : null;
  const uses = body.uses == null ? 1 : Number(body.uses);
  if (body.action === "use" && (!Number.isInteger(uses) || uses < 1 || uses > 1_000_000)) {
    return NextResponse.json({ error: "Uses to add must be a whole number of 1 or more." }, { status: 422 });
  }
  const qtyRaw = body.qty == null || body.qty === "" ? null : Number(body.qty);
  const qty = qtyRaw != null && Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.floor(qtyRaw) : null;
  const orderId = typeof body.order_id === "string" && body.order_id.trim() ? body.order_id.trim() : null;
  const result = await useOrReturnDie(await createClient(), {
    tenantId: ctx.tenant.id,
    id,
    action: body.action,
    actor: { id: ctx.userId, name: ctx.fullName || ctx.email },
    note,
    uses,
    orderId,
    qty,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
