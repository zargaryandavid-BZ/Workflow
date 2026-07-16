import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    staffNotes?: string | null;
  };

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const staffNotes =
    body.staffNotes === null || body.staffNotes === undefined
      ? null
      : String(body.staffNotes).trim() || null;

  const { data: updated, error: updateError } = await supabase
    .from("shipping_requests")
    .update({ staff_notes: staffNotes })
    .eq("order_id", orderId)
    .eq("tenant_id", tenantId)
    .select("id, staff_notes")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json(
      { error: "No shipping request for this order" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, staff_notes: updated.staff_notes });
}
