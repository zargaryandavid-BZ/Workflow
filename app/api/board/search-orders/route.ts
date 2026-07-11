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

/** PostgREST default max is 1000; page explicitly so filters cover every column. */
const FETCH_PAGE = 1000;

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

  const fieldsRes = await supabase
    .from("custom_fields")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true });

  const customFields = (fieldsRes.data ?? []) as CustomField[];

  // Fetch every matching order across pages so unloaded / "Load more" cards
  // are included in board filtration.
  const allOrders: OrderWithRelations[] = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    let query = supabase
      .from("orders")
      .select("*, customer:customers(*), tag:tags(id, name, color)")
      .eq("tenant_id", tenantId)
      .is("removed_at", null)
      .order("position", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + FETCH_PAGE - 1);

    if (ownerId) {
      query = query.eq("created_by", ownerId);
    }
    if (designerId) {
      query = query.eq("specs->>designer_id", designerId);
    }

    const ordersRes = await query;
    if (ordersRes.error) {
      return NextResponse.json(
        { error: "Failed to fetch orders" },
        { status: 500 }
      );
    }

    const page = (ordersRes.data ?? []) as OrderWithRelations[];
    allOrders.push(...page);
    if (page.length < FETCH_PAGE) break;
  }

  if (allOrders.length === 0) {
    return NextResponse.json({
      orders: [],
      fieldValuesByOrder: {},
      thumbnailByOrder: {},
      notificationBadgeByOrder: {},
      ownerNameByOrder: {},
      designerNameByOrder: {},
    } satisfies SearchOrdersResponse);
  }

  // custom_field_values .in() also has practical size limits — chunk it.
  const fieldValuesByOrder: Record<string, Record<string, unknown>> = {};
  const orderIds = allOrders.map((o) => o.id);
  const VALUE_CHUNK = 200;
  for (let i = 0; i < orderIds.length; i += VALUE_CHUNK) {
    const chunk = orderIds.slice(i, i + VALUE_CHUNK);
    const { data: valueRows } = await supabase
      .from("custom_field_values")
      .select("order_id, custom_field_id, value")
      .in("order_id", chunk);

    for (const v of (valueRows ?? []) as {
      order_id: string;
      custom_field_id: string;
      value: unknown;
    }[]) {
      (fieldValuesByOrder[v.order_id] ??= {})[v.custom_field_id] = v.value;
    }
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

  return NextResponse.json({
    orders,
    ...enrichment,
  } satisfies SearchOrdersResponse);
}
