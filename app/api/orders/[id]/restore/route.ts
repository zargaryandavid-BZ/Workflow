import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { logActivity } from "@/lib/automation";
import { loadOrderWithRelations } from "@/lib/orders/load-with-relations";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const { data: existingOrder } = await supabase
    .from("orders")
    .select("id, removed_at")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!existingOrder) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!existingOrder.removed_at) {
    return NextResponse.json({ error: "Order is not removed" }, { status: 400 });
  }

  const { error } = await supabase
    .from("orders")
    .update({
      removed_at: null,
      removed_by: null,
    })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await logActivity(supabase, {
    tenantId: ctx.tenant.id,
    orderId: id,
    actor: ctx.userId,
    action: "restored",
  });

  const order = await loadOrderWithRelations(supabase, id, tenantId);
  return NextResponse.json({ ok: true, order });
}
