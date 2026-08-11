import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { enrichBoardOrders } from "@/lib/board-order-enrichment";
import {
  isOrderNumberQuery,
  orderMatchesBoardFilters,
} from "@/lib/board-order-filters";
import {
  MANUAL_WEBHOOK_SOURCE_FILTER,
  OTHER_WEBHOOK_SOURCE_FILTER,
  UNASSIGNED_OWNER_FILTER,
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
  approvalDateByOrder: Record<string, string>;
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
  approvalDateByOrder: {},
});

export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const q = (searchParams.get("q") ?? "").trim().replace(/^#/, "");
  // Designers are locked to their own assignments (ignore client designerId).
  const designerId =
    ctx.role === "designer"
      ? ctx.userId
      : (searchParams.get("designerId") ?? "");
  const ownerId = searchParams.get("ownerId") ?? "";
  const webhookSource = (searchParams.get("webhookSource") ?? "").trim();
  const knownWebhookSourceKeys = (searchParams.get("knownSources") ?? "")
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  const overdueOnly =
    searchParams.get("overdueOnly") === "1" ||
    searchParams.get("overdueOnly") === "true";
  const dueTodayOnly =
    searchParams.get("dueTodayOnly") === "1" ||
    searchParams.get("dueTodayOnly") === "true";

  if (
    !q &&
    !designerId &&
    !ownerId &&
    !webhookSource &&
    !overdueOnly &&
    !dueTodayOnly
  ) {
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

  if (q && !isOrderNumberQuery(q)) {
    const terms = q.split(/\s+/).filter(Boolean);
    // For each term, collect matched customer IDs and order IDs from field values.
    // The DB casts a wide net (OR across terms); post-filter enforces AND.
    const customerIdSets: Set<string>[] = [];
    const orderIdSets: Set<string>[] = [];

    for (const term of terms) {
      const termPattern = `%${escapeIlike(term)}%`;
      const allFieldIds = customFields.map((f) => f.id);

      const custRes = await supabase
        .from("customers")
        .select("id")
        .eq("tenant_id", tenantId)
        .or(
          [
            `name.ilike.${termPattern}`,
            `email.ilike.${termPattern}`,
            `phone.ilike.${termPattern}`,
            `company.ilike.${termPattern}`,
          ].join(",")
        )
        .limit(200);
      customerIdSets.push(
        new Set(((custRes.data ?? []) as { id: string }[]).map((c) => c.id))
      );

      if (allFieldIds.length > 0) {
        const { data: cfRows } = await supabase
          .from("custom_field_values")
          .select("order_id")
          .in("custom_field_id", allFieldIds)
          .filter("value::text", "ilike", termPattern)
          .limit(500);
        orderIdSets.push(
          new Set(
            ((cfRows ?? []) as { order_id: string }[]).map((r) => r.order_id)
          )
        );
      } else {
        orderIdSets.push(new Set<string>());
      }
    }

    // Union customers and order IDs across all terms for the broad DB pre-filter.
    // (AND enforcement happens in orderMatchesBoardFilters post-filter.)
    matchedCustomerIds = [...new Set(customerIdSets.flatMap((s) => [...s]))];
    matchedOrderIdsFromFields = [
      ...new Set(orderIdSets.flatMap((s) => [...s])),
    ];
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

    if (ownerId === UNASSIGNED_OWNER_FILTER) {
      query = query.is("created_by", null);
    } else if (ownerId) {
      query = query.eq("created_by", ownerId);
    }
    if (designerId) {
      query = query.eq("specs->>designer_id", designerId);
    }
    if (webhookSource === MANUAL_WEBHOOK_SOURCE_FILTER) {
      query = query.is("webhook_source", null);
    } else if (webhookSource === OTHER_WEBHOOK_SOURCE_FILTER) {
      query = query.not("webhook_source", "is", null);
      if (knownWebhookSourceKeys.length > 0) {
        query = query.not(
          "webhook_source",
          "in",
          `(${knownWebhookSourceKeys.join(",")})`
        );
      }
    } else if (webhookSource) {
      query = query.eq("webhook_source", webhookSource.toLowerCase());
    }
    if (overdueOnly) {
      // Due before today's local calendar date (due today is not overdue yet).
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, "0");
      const d = String(today.getDate()).padStart(2, "0");
      query = query.not("due_date", "is", null).lt("due_date", `${y}-${m}-${d}`);
    }
    if (dueTodayOnly) {
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, "0");
      const d = String(today.getDate()).padStart(2, "0");
      query = query.eq("due_date", `${y}-${m}-${d}`);
    }

    if (q) {
      const terms = q.split(/\s+/).filter(Boolean);
      const orParts: string[] = [];
      for (const term of terms) {
        const termPattern = `%${escapeIlike(term)}%`;
        orParts.push(`title.ilike.${termPattern}`);
        orParts.push(`description.ilike.${termPattern}`);
      }
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

  let doneColumnIds: Set<string> | undefined;
  if (overdueOnly || dueTodayOnly) {
    const { data: doneCols } = await supabase
      .from("board_columns")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("kind", "done");
    doneColumnIds = new Set(
      ((doneCols ?? []) as { id: string }[]).map((c) => c.id)
    );
  }

  const filters = {
    q,
    personFilter: designerId,
    ownerFilter: ownerId,
    webhookSourceFilter: webhookSource,
    knownWebhookSourceKeys,
    overdueOnly,
    dueTodayOnly,
    doneColumnIds,
  };
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
