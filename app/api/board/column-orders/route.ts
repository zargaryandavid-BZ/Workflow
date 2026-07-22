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
  approvalDateByOrder: Record<string, string>;
  hasMore: boolean;
  total: number;
  page: number;
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

export async function GET(req: NextRequest) {
  try {
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
      console.error("[column-orders] Failed to fetch orders:", ordersError);
      const transient = isTransientUpstreamError(ordersError);
      return NextResponse.json(
        { error: "Failed to fetch orders", detail: ordersError.message },
        { status: transient ? 503 : 500 }
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
      approvalDateByOrder: {},
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
