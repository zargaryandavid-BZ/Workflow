import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { enrichBoardOrders } from "@/lib/board-order-enrichment";
import type { CardNotificationBadge } from "@/lib/card-badges";
import type { BoardShippingSign } from "@/lib/board-shipping";
import type { OrderWithRelations } from "@/lib/types";

export const PAGE_SIZE = 25;

export interface ColumnOrdersResponse {
  orders: OrderWithRelations[];
  fieldValuesByOrder: Record<string, Record<string, unknown>>;
  thumbnailByOrder: Record<string, string[]>;
  notificationBadgeByOrder: Record<string, CardNotificationBadge>;
  ownerNameByOrder: Record<string, string>;
  designerNameByOrder: Record<string, string>;
  shippingSignByOrder: Record<string, BoardShippingSign>;
  hasMore: boolean;
  total: number;
  page: number;
}

export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const columnId = searchParams.get("columnId");
  const page = Math.max(0, parseInt(searchParams.get("page") ?? "0", 10));

  if (!columnId) {
    return NextResponse.json({ error: "columnId required" }, { status: 400 });
  }

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data: rawOrders, error: ordersError, count } = await supabase
    .from("orders")
    .select("*, customer:customers(*), tag:tags(id, name, color)", {
      count: "exact",
    })
    .eq("tenant_id", tenantId)
    .eq("column_id", columnId)
    .is("removed_at", null)
    .order("position", { ascending: true })
    .range(from, to);

  if (ordersError) {
    return NextResponse.json(
      { error: "Failed to fetch orders" },
      { status: 500 }
    );
  }

  const orders = (rawOrders ?? []) as OrderWithRelations[];
  const total = count ?? 0;
  const hasMore = total > (page + 1) * PAGE_SIZE;

  const empty: ColumnOrdersResponse = {
    orders: [],
    fieldValuesByOrder: {},
    thumbnailByOrder: {},
    notificationBadgeByOrder: {},
    ownerNameByOrder: {},
    designerNameByOrder: {},
    shippingSignByOrder: {},
    hasMore: false,
    total,
    page,
  };

  if (orders.length === 0) {
    return NextResponse.json(empty);
  }

  const enrichment = await enrichBoardOrders(supabase, orders);

  const response: ColumnOrdersResponse = {
    orders,
    ...enrichment,
    hasMore,
    total,
    page,
  };

  return NextResponse.json(response);
}
