import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { enrichBoardOrders } from "@/lib/board-order-enrichment";
import { orderMatchesBoardFilters } from "@/lib/board-order-filters";
import {
  CUSTOMER_CONTACT_FIELD_NAME,
  CUSTOMER_NAME_FIELD_NAME,
} from "@/lib/constants";
import type { CardNotificationBadge } from "@/lib/card-badges";
import type { BoardShippingSign } from "@/lib/board-shipping";
import type { CustomField, OrderWithRelations } from "@/lib/types";

export interface SearchOrdersResponse {
  orders: OrderWithRelations[];
  fieldValuesByOrder: Record<string, Record<string, unknown>>;
  thumbnailByOrder: Record<string, string[]>;
  notificationBadgeByOrder: Record<string, CardNotificationBadge>;
  ownerNameByOrder: Record<string, string>;
  designerNameByOrder: Record<string, string>;
  shippingSignByOrder: Record<string, BoardShippingSign>;
}

/** PostgREST default max is 1000; page explicitly so filters cover every column. */
const FETCH_PAGE = 1000;

/** Escape `%`, `_`, and `,` for PostgREST `or` / `ilike` filter strings. */
function escapeIlike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/[%_,]/g, "\\$&");
}

const emptyResponse = (): SearchOrdersResponse => ({
  orders: [],
  fieldValuesByOrder: {},
  thumbnailByOrder: {},
  notificationBadgeByOrder: {},
  ownerNameByOrder: {},
  designerNameByOrder: {},
  shippingSignByOrder: {},
});

export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const q = (searchParams.get("q") ?? "").trim();
  const designerId = searchParams.get("designerId") ?? "";
  const ownerId = searchParams.get("ownerId") ?? "";

  if (!q && !designerId && !ownerId) {
    return NextResponse.json(emptyResponse());
  }

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const fieldsRes = await supabase
    .from("custom_fields")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true });

  const customFields = (fieldsRes.data ?? []) as CustomField[];

  // Narrow at the DB instead of loading every order then filtering in JS.
  let matchedCustomerIds: string[] = [];
  let matchedOrderIdsFromFields: string[] = [];

  if (q) {
    const pattern = `%${escapeIlike(q)}%`;
    const nameFieldIds = customFields
      .filter(
        (f) =>
          f.name.toLowerCase() === CUSTOMER_NAME_FIELD_NAME.toLowerCase() ||
          f.name.toLowerCase() === CUSTOMER_CONTACT_FIELD_NAME.toLowerCase()
      )
      .map((f) => f.id);

    const customersRes = await supabase
      .from("customers")
      .select("id")
      .eq("tenant_id", tenantId)
      .or(
        [
          `name.ilike.${pattern}`,
          `email.ilike.${pattern}`,
          `phone.ilike.${pattern}`,
          `company.ilike.${pattern}`,
        ].join(",")
      )
      .limit(200);

    matchedCustomerIds = ((customersRes.data ?? []) as { id: string }[]).map(
      (c) => c.id
    );

    // Best-effort: match Customer Name / Contact custom field values.
    // Skip quietly if the cast filter isn't supported by PostgREST.
    if (nameFieldIds.length > 0) {
      const { data: cfRows, error: cfError } = await supabase
        .from("custom_field_values")
        .select("order_id")
        .in("custom_field_id", nameFieldIds)
        .filter("value::text", "ilike", pattern)
        .limit(500);
      if (!cfError && cfRows) {
        matchedOrderIdsFromFields = [
          ...new Set(
            (cfRows as { order_id: string }[]).map((r) => r.order_id)
          ),
        ];
      }
    }
  }

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

    if (q) {
      const pattern = `%${escapeIlike(q)}%`;
      const orParts = [`title.ilike.${pattern}`];
      if (matchedCustomerIds.length > 0) {
        orParts.push(`customer_id.in.(${matchedCustomerIds.join(",")})`);
      }
      if (matchedOrderIdsFromFields.length > 0) {
        orParts.push(`id.in.(${matchedOrderIdsFromFields.join(",")})`);
      }
      query = query.or(orParts.join(","));
    }

    const ordersRes = await query;
    if (ordersRes.error) {
      console.error("[search-orders]", ordersRes.error);
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
    return NextResponse.json(emptyResponse());
  }

  // Only load field values for the narrowed candidate set (enrich also loads
  // them; we need them here for orderMatchesBoardFilters accuracy).
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
