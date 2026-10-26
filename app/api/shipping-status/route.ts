import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  buildShippingStatusItems,
  splitShippingStatusItems,
  type ShippingStatusRow,
} from "@/lib/shipping-status";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shipping_requests")
    .select(
      `
        id,
        order_id,
        status,
        client_choice,
        fedex_selection,
        delivery_address,
        fedex_tracking_number,
        responded_at,
        created_at,
        shipping_status_seen_at,
        shipping_status_removed_at,
        order:orders!inner(
          id,
          title,
          customer:customers(name)
        )
      `
    )
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "client_responded")
    .order("responded_at", { ascending: false, nullsFirst: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = buildShippingStatusItems(
    (data ?? []) as unknown as ShippingStatusRow[]
  );
  return NextResponse.json({
    ...splitShippingStatusItems(items),
    newCount: items.filter((item) => item.isNew).length,
  });
}
