import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { enrichBoardOrders } from "@/lib/board-order-enrichment";
import {
  isColumnSortMode,
  type ColumnSortMode,
} from "@/lib/board-column-sort";
import type { CardNotificationBadge } from "@/lib/card-badges";
import type { BoardShippingSign } from "@/lib/board-shipping";
import type { DieAlert, DieBoardStatus } from "@/lib/die-request";
import type { BoardThumbnail } from "@/lib/card-image";
import type { OrderWithRelations } from "@/lib/types";
import { isDesignerQueueColumnName } from "@/lib/designer-queue-columns";
import { rankDesignerQueue } from "@/lib/designer-queue-rank";
import { groupingKeysForSiblingFetch } from "@/lib/group-orders";

export const PAGE_SIZE = 25;

export interface ColumnOrdersResponse {
  orders: OrderWithRelations[];
  fieldValuesByOrder: Record<string, Record<string, unknown>>;
  thumbnailByOrder: Record<string, BoardThumbnail[]>;
  notificationBadgeByOrder: Record<string, CardNotificationBadge>;
  ownerNameByOrder: Record<string, string>;
  designerNameByOrder: Record<string, string>;
  shippingSignByOrder: Record<string, BoardShippingSign>;
  dieAlertByOrder: Record<string, DieAlert>;
  dieStatusByOrder: Record<string, DieBoardStatus>;
  approvalDateByOrder: Record<string, string>;
  hasMore: boolean;
  total: number;
  page: number;
  sort: ColumnSortMode;
}

function isTransientUpstreamError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message =
    "message" in err && typeof err.message === "string" ? err.message : "";
  const cause =
    "cause" in err && err.cause && typeof err.cause === "object"
      ? (err.cause as { code?: string; message?: string })
      : null;
  const code = cause?.code ?? ("code" in err ? String(err.code) : "");
  return (
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "ENOTFOUND" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    /fetch failed|Connect Timeout|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(
      message
    ) ||
    /fetch failed|Connect Timeout|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(
      cause?.message ?? ""
    )
  );
}

/** Apply DB order so pagination matches the column sort dropdown. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applySortToOrdersQuery(query: any, sort: ColumnSortMode) {
  switch (sort) {
    case "manual":
      return query.order("position", { ascending: true });
    case "created_desc":
      return query
        .order("created_at", { ascending: false })
        .order("position", { ascending: true });
    case "created_asc":
      return query
        .order("created_at", { ascending: true })
        .order("position", { ascending: true });
    case "due_asc":
      return query
        .order("due_date", { ascending: true, nullsFirst: true })
        .order("position", { ascending: true });
    case "due_desc":
      return query
        .order("due_date", { ascending: false, nullsFirst: true })
        .order("position", { ascending: true });
    case "title_asc":
      return query
        .order("title", { ascending: true })
        .order("position", { ascending: true });
    case "title_desc":
      return query
        .order("title", { ascending: false })
        .order("position", { ascending: true });
    case "priority_desc":
      return query
        .order("specs->priority_score", {
          ascending: false,
          nullsFirst: false,
        })
        .order("position", { ascending: true });
    case "priority_asc":
      return query
        .order("specs->priority_score", {
          ascending: true,
          nullsFirst: true,
        })
        .order("position", { ascending: true });
    case "moved_asc":
      return query
        .order("last_moved_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .order("position", { ascending: true });
    case "moved_desc":
    default:
      return query
        .order("last_moved_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("position", { ascending: true });
  }
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getTenantContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = req.nextUrl;
    const columnId = searchParams.get("columnId");
    const page = Math.max(0, parseInt(searchParams.get("page") ?? "0", 10));
    const sortParam = searchParams.get("sort");
    const sort: ColumnSortMode = isColumnSortMode(sortParam)
      ? sortParam
      : "moved_desc";
    const groupSiblings =
      searchParams.get("groupSiblings") === "1" ||
      searchParams.get("groupSiblings") === "true";

    if (!columnId) {
      return NextResponse.json({ error: "columnId required" }, { status: 400 });
    }

    const supabase = await createClient();
    const tenantId = ctx.tenant.id;

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("orders")
      .select("*, customer:customers(*), tag:tags(id, name, color)", {
        count: "exact",
      })
      .eq("tenant_id", tenantId)
      .eq("column_id", columnId)
      .is("removed_at", null);

    // Designers only see cards assigned to them.
    if (ctx.role === "designer") {
      query = query.eq("specs->>designer_id", ctx.userId);
    }

    query = applySortToOrdersQuery(query, sort);

    const { data: rawOrders, error: ordersError, count } = await query.range(
      from,
      to
    );

    if (ordersError) {
      console.error("[column-orders] Failed to fetch orders:", ordersError);
      const transient = isTransientUpstreamError(ordersError);
      return NextResponse.json(
        { error: "Failed to fetch orders", detail: ordersError.message },
        { status: transient ? 503 : 500 }
      );
    }

    const pageOrders = (rawOrders ?? []) as OrderWithRelations[];
    const total = count ?? 0;
    const hasMore = total > (page + 1) * PAGE_SIZE;
    const orders = groupSiblings
      ? await withSameColumnGroupSiblings(
          supabase,
          tenantId,
          columnId,
          ctx.role === "designer" ? ctx.userId : null,
          pageOrders
        )
      : pageOrders;

    const empty: ColumnOrdersResponse = {
      orders: [],
      fieldValuesByOrder: {},
      thumbnailByOrder: {},
      notificationBadgeByOrder: {},
      ownerNameByOrder: {},
      designerNameByOrder: {},
      shippingSignByOrder: {},
      dieAlertByOrder: {},
      dieStatusByOrder: {},
      approvalDateByOrder: {},
      hasMore: false,
      total,
      page,
      sort,
    };

    if (orders.length === 0) {
      return NextResponse.json(empty);
    }

    const enrichment = await enrichBoardOrders(supabase, orders);

    // Designer queue rank (#N badge): only for Start / In Progress columns.
    // Computed live so the badge works with zero stored data on any tenant.
    await attachQueueRanks(supabase, tenantId, columnId, orders);

    const response: ColumnOrdersResponse = {
      orders,
      ...enrichment,
      hasMore,
      total,
      page,
      sort,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[column-orders] Unexpected error:", err);
    const transient = isTransientUpstreamError(err);
    return NextResponse.json(
      {
        error: transient
          ? "Upstream database temporarily unavailable"
          : "Failed to fetch column orders",
      },
      { status: transient ? 503 : 500 }
    );
  }
}

function escapeIlike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/[%_,]/g, "\\$&");
}

/**
 * Pagination only returns PAGE_SIZE rows, so 129-1 can load without 129-2.
 * Pull other same-column parts for keys already on this page so Group view
 * can stack them.
 */
async function withSameColumnGroupSiblings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  columnId: string,
  designerId: string | null,
  pageOrders: OrderWithRelations[]
): Promise<OrderWithRelations[]> {
  if (pageOrders.length === 0) return pageOrders;
  const { webhookKeys, titlePrefixes } = groupingKeysForSiblingFetch(pageOrders);
  const orParts: string[] = [];
  for (const key of webhookKeys) {
    if (key.includes(",") || key.includes(")")) continue;
    orParts.push(`specs->>webhook_order_number.eq.${key}`);
  }
  for (const prefix of titlePrefixes) {
    if (prefix.includes(",") || prefix.includes(")")) continue;
    orParts.push(`title.ilike.${escapeIlike(prefix)}-%`);
  }
  if (orParts.length === 0) return pageOrders;

  const existingIds = new Set(pageOrders.map((o) => o.id));
  let query = supabase
    .from("orders")
    .select("*, customer:customers(*), tag:tags(id, name, color)")
    .eq("tenant_id", tenantId)
    .eq("column_id", columnId)
    .is("removed_at", null)
    .or(orParts.join(","))
    .limit(300);
  if (designerId) {
    query = query.eq("specs->>designer_id", designerId);
  }

  const { data, error } = await query;
  if (error || !data) {
    if (error) {
      console.warn("[column-orders] group sibling fetch skipped:", error.message);
    }
    return pageOrders;
  }

  const extras = (data as OrderWithRelations[]).filter(
    (order) => !existingIds.has(order.id)
  );
  if (extras.length === 0) return pageOrders;
  return [...pageOrders, ...extras];
}

/**
 * Attach `queue_rank` to each order when the fetched column is Start / In
 * Progress. Ranks a designer's cards across BOTH those columns so the number is
 * their true queue position, honoring any saved order first. Mutates `orders`.
 */
async function attachQueueRanks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  columnId: string,
  orders: OrderWithRelations[]
): Promise<void> {
  if (orders.length === 0) return;

  const { data: cols } = await supabase
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", tenantId);
  const columnsById = new Map<string, string>(
    (cols ?? []).map((c: { id: string; name: string }) => [c.id, c.name])
  );
  const currentName = columnsById.get(columnId);
  if (!isDesignerQueueColumnName(currentName)) return;

  const queueColumnIds = (cols ?? [])
    .filter((c: { name: string }) => isDesignerQueueColumnName(c.name))
    .map((c: { id: string }) => c.id);
  if (queueColumnIds.length === 0) return;

  const designerIds = Array.from(
    new Set(
      orders
        .map((o) => {
          const d = (o.specs as { designer_id?: unknown } | null)?.designer_id;
          return typeof d === "string" && d ? d : null;
        })
        .filter((d): d is string => Boolean(d))
    )
  );
  if (designerIds.length === 0) return;

  const { data: rows } = await supabase
    .from("orders")
    .select("id, priority, due_date, specs")
    .eq("tenant_id", tenantId)
    .in("column_id", queueColumnIds)
    .in("specs->>designer_id", designerIds)
    .is("removed_at", null)
    .limit(4000);

  const rankByOrder = rankDesignerQueue(
    (rows ?? []).map(
      (r: {
        id: string;
        priority: string | null;
        due_date: string | null;
        specs: unknown;
      }) => {
        const specs = (r.specs ?? {}) as Record<string, unknown>;
        const posRaw = specs.designer_queue_pos;
        const pos =
          typeof posRaw === "number"
            ? posRaw
            : Number.isFinite(Number(posRaw))
              ? Number(posRaw)
              : null;
        return {
          id: r.id,
          designerId: String(specs.designer_id ?? ""),
          queuePos: pos,
          priority: r.priority,
          dueDate: r.due_date,
        };
      }
    )
  );

  for (const o of orders) {
    o.queue_rank = rankByOrder[o.id] ?? null;
  }
}
