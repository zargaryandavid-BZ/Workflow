import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { VENDOR_STATUSES } from "@/lib/purchase-order";
import { appendHistory } from "@/lib/purchase-order.server";
import { logActivity } from "@/lib/automation";

/** Public: the vendor posts status / ship date / tracking from their PO link. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const status = String(body.status ?? "").trim();
  if (!(VENDOR_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "Pick a status." }, { status: 422 });
  }
  const note = String(body.note ?? "").trim().slice(0, 2000) || null;
  const tracking = String(body.tracking ?? "").trim().slice(0, 200) || null;
  const admin = createAdminClient();
  const { data: po } = await admin
    .from("purchase_orders")
    .select("id, tenant_id, order_id, status, history, po_number")
    .eq("token", token)
    .maybeSingle();
  if (!po || po.status === "draft" || po.status === "cancelled") {
    return NextResponse.json({ error: "This purchase order is not open." }, { status: 404 });
  }
  const now = new Date().toISOString();
  const { error } = await admin
    .from("purchase_orders")
    .update({
      status: status === "shipped" ? "shipped" : "confirmed",
      vendor_status: status,
      vendor_note: note,
      vendor_tracking: tracking,
      vendor_updated_at: now,
      updated_at: now,
      history: appendHistory(po.history, {
        at: now,
        by: "Vendor",
        action: `vendor update: ${status}${tracking ? ` (tracking ${tracking})` : ""}`,
        note,
      }),
    })
    .eq("id", po.id);
  if (error) return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  await logActivity(admin, {
    tenantId: po.tenant_id as string,
    orderId: po.order_id as string,
    actor: null,
    action: "purchase_order_vendor_update",
    metadata: { po_number: po.po_number, status, tracking, note },
  }).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
