import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewDieOrder } from "@/lib/permissions";
import { PO_STATUSES, poTotal, sanitizePoItems } from "@/lib/purchase-order";
import { appendHistory } from "@/lib/purchase-order.server";

/** Edit a PO (any field) or set its status (e.g. received / cancelled). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewDieOrder(ctx.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const supabase = await createClient();
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, tenant_id, history, status")
    .eq("id", id)
    .maybeSingle();
  if (!po || po.tenant_id !== ctx.tenant.id) {
    return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("items" in body) {
    const items = sanitizePoItems(body.items);
    patch.items = items;
    patch.total = poTotal(items);
  }
  for (const key of ["po_number", "ship_to", "notes", "folder_url"] as const) {
    if (key in body) patch[key] = String(body[key] ?? "").trim() || null;
  }
  if (patch.po_number === null) delete patch.po_number;
  if ("due_date" in body) {
    const d = String(body.due_date ?? "").trim();
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return NextResponse.json({ error: "Due date must be YYYY-MM-DD." }, { status: 422 });
    }
    patch.due_date = d || null;
  }
  if ("vendor_id" in body) patch.vendor_id = String(body.vendor_id ?? "").trim() || null;
  let action = "edited";
  if ("status" in body) {
    const status = String(body.status ?? "");
    if (!(PO_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: "Unknown status" }, { status: 422 });
    }
    patch.status = status;
    action = `status → ${status}`;
  }
  patch.history = appendHistory(po.history, {
    at: new Date().toISOString(),
    by: ctx.fullName || ctx.email || "Staff",
    action,
  });

  const { data, error } = await supabase
    .from("purchase_orders")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ purchaseOrder: data });
}
