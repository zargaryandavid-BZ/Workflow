import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewDieOrder } from "@/lib/permissions";
import { sendTransactionalEmail } from "@/lib/email";
import { logActivity } from "@/lib/automation";
import { formatDate } from "@/lib/utils";
import {
  buildPoEmailHtml,
  buildPoEmailText,
  poEmailSubject,
  sanitizePoItems,
} from "@/lib/purchase-order";
import { appendHistory, vendorPoUrl } from "@/lib/purchase-order.server";

/** Email the PO + file folder link to the vendor. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewDieOrder(ctx.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const supabase = await createClient();
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("*, outsource_vendors(*)")
    .eq("id", id)
    .maybeSingle();
  if (!po || po.tenant_id !== ctx.tenant.id) {
    return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
  }
  const vendor = po.outsource_vendors as { name?: string; email?: string; contact_name?: string | null } | null;
  if (!vendor?.email) {
    return NextResponse.json({ error: "Pick a vendor first." }, { status: 422 });
  }
  const items = sanitizePoItems(po.items);
  if (items.length === 0) {
    return NextResponse.json({ error: "Add at least one item." }, { status: 422 });
  }
  const vendorUrl = await vendorPoUrl(supabase, ctx.tenant.id, po.token as string);
  const fromName = ctx.fullName || "Bazaar Printing";
  const input = {
    poNumber: po.po_number as string,
    vendorContact: vendor.contact_name?.trim() || null,
    items,
    shipTo: (po.ship_to as string | null) ?? null,
    dueDate: po.due_date ? formatDate(po.due_date as string) || (po.due_date as string) : null,
    notes: (po.notes as string | null) ?? null,
    folderUrl: (po.folder_url as string | null) ?? null,
    vendorUrl,
    fromName,
  };
  const result = await sendTransactionalEmail({
    to: vendor.email,
    subject: poEmailSubject(input.poNumber),
    html: buildPoEmailHtml(input),
    text: buildPoEmailText(input),
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
      status: po.status === "draft" ? "sent" : po.status,
      sent_at: now,
      updated_at: now,
      history: appendHistory(po.history, {
        at: now,
        by: fromName,
        action: `sent to ${vendor.name ?? vendor.email} (${vendor.email})`,
      }),
    })
    .eq("id", id)
    .select("*")
    .single();
  await logActivity(supabase, {
    tenantId: ctx.tenant.id,
    orderId: po.order_id as string,
    actor: ctx.userId,
    action: "purchase_order_sent",
    metadata: { po_number: input.poNumber, vendor: vendor.name, to: vendor.email },
  }).catch(() => undefined);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ purchaseOrder: data });
}
