import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { deleteDie, logDieEvent } from "@/lib/dies.server";
import { canViewDieOrder } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

/**
 * POST: cancel a die request that hasn't been confirmed yet (Waiting / Quoted).
 * The request is removed (its link stops working). If it was ordering a new
 * die that was never received, that die is deleted too, so nothing stays
 * hidden "on order". A die already in the library just keeps a history note.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewDieOrder(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const supabase = await createClient();

  const { data: removed, error } = await supabase
    .from("die_requests")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .in("status", ["sent", "quoted"])
    .select("id, die_id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!removed) {
    return NextResponse.json(
      { error: "Only a request that is still waiting or quoted can be cancelled." },
      { status: 409 }
    );
  }

  const actor = { id: ctx.userId, name: ctx.fullName || ctx.email };
  const dieId = (removed as { die_id?: string | null }).die_id;
  let dieDeleted = false;
  if (dieId) {
    const { data: die } = await supabase
      .from("dies")
      .select("id, on_order")
      .eq("id", dieId)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle();
    const { count } = await supabase
      .from("die_requests")
      .select("id", { count: "exact", head: true })
      .eq("die_id", dieId);
    if ((die as { on_order?: boolean } | null)?.on_order && !count) {
      const result = await deleteDie(supabase, ctx.tenant.id, dieId, actor);
      dieDeleted = "ok" in result;
    } else if (die) {
      await logDieEvent(supabase, {
        tenantId: ctx.tenant.id,
        dieId,
        kind: "edited",
        actor,
        note: "Quote request cancelled",
      });
    }
  }
  return NextResponse.json({ ok: true, dieDeleted });
}
