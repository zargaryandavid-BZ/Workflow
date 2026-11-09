import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewDieOrder } from "@/lib/permissions";
import {
  BAZAAR_SHIP_TO,
  defaultPoItems,
  orderFolderUrl,
  poNumberForOrder,
  poTotal,
} from "@/lib/purchase-order";
import {
  appendHistory,
  loadOrderForPo,
  PO_MIGRATION_HINT,
  poMigrationMissing,
} from "@/lib/purchase-order.server";

export async function GET(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orderId = new URL(request.url).searchParams.get("orderId")?.trim();
  if (!orderId) return NextResponse.json({ error: "orderId required" }, { status: 422 });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_orders")
    .select("*")
    .eq("tenant_id", ctx.tenant.id)
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json(
      { error: poMigrationMissing(error.message) ? PO_MIGRATION_HINT : error.message, migrationMissing: poMigrationMissing(error.message) },
      { status: 400 }
    );
  }
  return NextResponse.json({ purchaseOrders: data ?? [] });
}

/** Create a draft PO pre-filled from the card. Nothing is sent. */
export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewDieOrder(ctx.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { orderId?: string };
  const orderId = String(body.orderId ?? "").trim();
  if (!orderId) return NextResponse.json({ error: "orderId required" }, { status: 422 });
  const supabase = await createClient();
  const loaded = await loadOrderForPo(supabase, ctx.tenant.id, orderId);
  if (!loaded) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const { count } = await supabase
    .from("purchase_orders")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId);
  const items = defaultPoItems({ fields: loaded.fields, specs: loaded.order.specs });
  const { data, error } = await supabase
    .from("purchase_orders")
    .insert({
      tenant_id: ctx.tenant.id,
      order_id: orderId,
      po_number: poNumberForOrder(loaded.order.title, count ?? 0),
      status: "draft",
      items,
      total: poTotal(items),
      ship_to: BAZAAR_SHIP_TO,
      due_date: loaded.order.due_date ? loaded.order.due_date.slice(0, 10) : null,
      folder_url: orderFolderUrl(loaded.fields, loaded.order.specs),
      history: appendHistory([], {
        at: new Date().toISOString(),
        by: ctx.fullName || ctx.email || "Staff",
        action: "created",
      }),
      created_by: ctx.userId,
    })
    .select("*")
    .single();
  if (error) {
    return NextResponse.json(
      { error: poMigrationMissing(error.message) ? PO_MIGRATION_HINT : error.message },
      { status: 400 }
    );
  }
  return NextResponse.json({ purchaseOrder: data });
}
