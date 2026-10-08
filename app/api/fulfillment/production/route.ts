import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { createClient } from "@/lib/supabase/server";
import { orderCardThumbnails } from "@/lib/board-order-enrichment";
import { firstThumbnailUrl } from "@/lib/card-image";
import { partCardTitle } from "@/lib/group-orders";
import { formatShortOrderNumber } from "@/lib/order-number-tokens";
import { columnNameIsActiveProduction } from "@/lib/prepress-production-handoff";

export async function GET() {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const supabase = await createClient();
  const { data: columns, error: colError } = await supabase
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", ctx.tenant.id);

  if (colError) {
    return NextResponse.json({ error: colError.message }, { status: 500 });
  }

  const productionIds = (columns ?? [])
    .filter((col) => columnNameIsActiveProduction(col.name))
    .map((col) => col.id);

  if (productionIds.length === 0) {
    return NextResponse.json({ orders: [] });
  }

  const { data: orders, error: orderError } = await supabase
    .from("orders")
    .select("id, title, specs, column_id")
    .eq("tenant_id", ctx.tenant.id)
    .is("removed_at", null)
    .in("column_id", productionIds)
    .order("title", { ascending: true });

  if (orderError) {
    return NextResponse.json({ error: orderError.message }, { status: 500 });
  }

  const rows = (orders ?? []) as {
    id: string;
    title: string;
    specs: Record<string, unknown> | null;
    column_id: string | null;
  }[];
  const thumbs = await orderCardThumbnails(supabase, rows);

  return NextResponse.json({
    orders: rows.map((order) => ({
      id: order.id,
      title: order.title,
      specs: order.specs,
      order_number: formatShortOrderNumber(order.title),
      item_title: partCardTitle(order) ?? "",
      thumbnail_url: firstThumbnailUrl(thumbs[order.id]) ?? null,
      column_id: order.column_id,
    })),
  });
}
