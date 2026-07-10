import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { enrichBoardOrders } from "@/lib/board-order-enrichment";
import { orderMatchesBoardFilters } from "@/lib/board-order-filters";
import type { CardNotificationBadge } from "@/lib/card-badges";
import type { CustomField, OrderWithRelations } from "@/lib/types";

export interface SearchOrdersResponse {
  orders: OrderWithRelations[];
  fieldValuesByOrder: Record<string, Record<string, unknown>>;
  thumbnailByOrder: Record<string, string[]>;
  notificationBadgeByOrder: Record<string, CardNotificationBadge>;
  ownerNameByOrder: Record<string, string>;
  designerNameByOrder: Record<string, string>;
}

export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q") ?? "";
  const designerId = searchParams.get("designerId") ?? "";
  const ownerId = searchParams.get("ownerId") ?? "";

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const [ordersRes, fieldsRes] = await Promise.all([
    (() => {
      let query = supabase
        .from("orders")
        .select("*, customer:customers(*), tag:tags(id, name, color)")
        .eq("tenant_id", tenantId)
        .is("removed_at", null)
        .order("position", { ascending: true });

      if (ownerId) {
        query = query.eq("created_by", ownerId);
      }
      if (designerId) {
        query = query.eq("specs->>designer_id", designerId);
      }

      return query;
    })(),
    supabase
      .from("custom_fields")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true }),
  ]);

  if (ordersRes.error) {
    return NextResponse.json(
      { error: "Failed to fetch orders" },
      { status: 500 }
    );
  }

  const allOrders = (ordersRes.data ?? []) as OrderWithRelations[];
  const customFields = (fieldsRes.data ?? []) as CustomField[];

  if (allOrders.length === 0) {
    const empty: SearchOrdersResponse = {
      orders: [],
      fieldValuesByOrder: {},
      thumbnailByOrder: {},
      notificationBadgeByOrder: {},
      ownerNameByOrder: {},
      designerNameByOrder: {},
    };
    return NextResponse.json(empty);
  }

  const orderIds = allOrders.map((o) => o.id);
  const { data: valueRows } = await supabase
    .from("custom_field_values")
    .select("order_id, custom_field_id, value")
    .in("order_id", orderIds);

  const fieldValuesByOrder: Record<string, Record<string, unknown>> = {};
  for (const v of (valueRows ?? []) as {
    order_id: string;
    custom_field_id: string;
    value: unknown;
  }[]) {
    (fieldValuesByOrder[v.order_id] ??= {})[v.custom_field_id] = v.value;
  }

  const filters = { q, personFilter: designerId, ownerFilter: ownerId };
  const orders = allOrders.filter((order) =>
    orderMatchesBoardFilters(
      order,
      fieldValuesByOrder[order.id] ?? {},
      customFields,
      filters
    )
  );

  const enrichment = await enrichBoardOrders(supabase, orders);

  const response: SearchOrdersResponse = {
    orders,
    ...enrichment,
  };

  return NextResponse.json(response);
}
