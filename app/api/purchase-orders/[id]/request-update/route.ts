import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewDieOrder } from "@/lib/permissions";
import { sendTransactionalEmail } from "@/lib/email";
import {
  buildPoUpdateHtml,
  buildPoUpdateText,
  poUpdateSubject,
} from "@/lib/purchase-order";
import { appendHistory, vendorPoUrl } from "@/lib/purchase-order.server";

/** Email the vendor asking for a status update on a sent PO. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewDieOrder(ctx.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { message?: string };
  const message = String(body.message ?? "").trim().slice(0, 1000) || null;
  const supabase = await createClient();
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("*, outsource_vendors(*)")
    .eq("id", id)
    .maybeSingle();
  if (!po || po.tenant_id !== ctx.tenant.id) {
    return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
  }
  if (!po.sent_at) {
    return NextResponse.json({ error: "Send the PO to the vendor first." }, { status: 422 });
  }
  const vendor = po.outsource_vendors as { name?: string; email?: string; contact_name?: string | null } | null;
  if (!vendor?.email) return NextResponse.json({ error: "No vendor email." }, { status: 422 });
  const vendorUrl = await vendorPoUrl(supabase, ctx.tenant.id, po.token as string);
  const fromName = ctx.fullName || "Bazaar Printing";
  const input = {
    poNumber: po.po_number as string,
    vendorContact: vendor.contact_name?.trim() || null,
    vendorUrl,
    message,
    fromName,
  };
  const result = await sendTransactionalEmail({
    to: vendor.email,
    subject: poUpdateSubject(input.poNumber),
    html: buildPoUpdateHtml(input),
    text: buildPoUpdateText(input),
  });
  if (!result.sent) {
    return NextResponse.json(
      { error: `Email to ${vendor.email} failed: ${result.error ?? "unknown"}` },
      { status: 502 }
    );
  }
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("purchase_orders")
    .update({
      status: "update_requested",
      update_requested_at: now,
      updated_at: now,
      history: appendHistory(po.history, {
        at: now,
        by: fromName,
        action: "requested an update",
        note: message,
      }),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ purchaseOrder: data });
}
