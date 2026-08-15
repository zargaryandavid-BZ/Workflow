import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantContext } from "@/lib/auth";
import { resolveCustomerApprovalActionUrl } from "@/lib/approval-group";
import { respondUrl } from "@/lib/notification-messages";
import type { Order } from "@/lib/types";

/**
 * Resolves the public customer approval URL for this card.
 * Multi-item groups → /respond/g/{portal}?item={orderId} so Open lands on this sub-item.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token")?.trim() ?? "";
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: notification, error: nErr } = await supabase
    .from("job_notifications")
    .select("id, token, type, order_id, tenant_id")
    .eq("token", token)
    .eq("order_id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (nErr) {
    return NextResponse.json({ error: nErr.message }, { status: 500 });
  }
  if (!notification || notification.type !== "customer_approval") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: order, error: oErr } = await supabase
    .from("orders")
    .select("id, title, tenant_id, column_id, description, specs")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (oErr) {
    return NextResponse.json({ error: oErr.message }, { status: 500 });
  }
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Admin: portal ensure/list may need to bypass incomplete RLS on portals table.
  const admin = createAdminClient();
  const url = await resolveCustomerApprovalActionUrl(
    admin,
    order as Order,
    token
  );

  return NextResponse.json({
    url: url || respondUrl(token),
  });
}
