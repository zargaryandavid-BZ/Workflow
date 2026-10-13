import type { SupabaseClient } from "@supabase/supabase-js";
import { orderCardThumbnails } from "@/lib/board-order-enrichment";
import { firstThumbnailUrl } from "@/lib/card-image";
import { partCardTitle } from "@/lib/group-orders";
import { formatShortOrderNumber } from "@/lib/order-number-tokens";
import { stageKey } from "@/lib/stage-groups";
import {
  productionOrderDetails,
  type ProductionSkuDetail,
} from "@/lib/fulfillment-production-details";
import { loadFinalArtworkSummary } from "@/lib/final-artwork-sku-count";

/** Same board column as Kanban "In Production" — not Hrach / Apparel / Outsource. */
export function columnNameIsInProductionBoard(
  name: string | null | undefined
): boolean {
  if (!name?.trim()) return false;
  return stageKey(name) === stageKey("In Production");
}

export interface FulfillmentProductionOrder {
  id: string;
  title: string;
  specs: Record<string, unknown> | null;
  order_number: string;
  item_title: string;
  thumbnail_url: string | null;
  product_type: string;
  sku_count: number;
  total_qty: number;
  sku_details: ProductionSkuDetail[];
  column_id: string | null;
}

export async function listProductionOrders(
  supabase: SupabaseClient,
  tenantId: string
): Promise<{ orders: FulfillmentProductionOrder[] } | { error: string }> {
  const { data: columns, error: colError } = await supabase
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", tenantId);

  if (colError) return { error: colError.message };

  const productionIds = (columns ?? [])
    .filter((col) => columnNameIsInProductionBoard(col.name))
    .map((col) => col.id);

  if (productionIds.length === 0) {
    return { orders: [] };
  }

  const { data: orders, error: orderError } = await supabase
    .from("orders")
    .select("id, title, specs, column_id")
    .eq("tenant_id", tenantId)
    .is("removed_at", null)
    .in("column_id", productionIds)
    .order("title", { ascending: true });

  if (orderError) return { error: orderError.message };

  const rows = (orders ?? []) as {
    id: string;
    title: string;
    specs: Record<string, unknown> | null;
    column_id: string | null;
  }[];
  const thumbs = await orderCardThumbnails(supabase, rows);
  const finalArtworkSummaries = new Map(
    await Promise.all(
      rows.map(async (order) => [
        order.id,
        await loadFinalArtworkSummary(order.id),
      ] as const)
    )
  );

  return {
    orders: rows.map((order) => {
      const itemTitle = partCardTitle(order) ?? "";
      const orderThumbs = thumbs[order.id] ?? [];
      const finalArtwork = finalArtworkSummaries.get(order.id);
      const artworkUrls =
        finalArtwork && finalArtwork.artworkUrls.length > 0
          ? finalArtwork.artworkUrls
          : orderThumbs.map((thumb) => thumb.url);
      return {
        id: order.id,
        title: order.title,
        specs: order.specs,
        order_number: formatShortOrderNumber(order.title),
        item_title: itemTitle,
        thumbnail_url:
          artworkUrls.find((url) => url.trim()) ??
          firstThumbnailUrl(orderThumbs) ??
          null,
        ...productionOrderDetails(
          order.specs,
          itemTitle,
          artworkUrls,
          finalArtwork?.count
        ),
        column_id: order.column_id,
      };
    }),
  };
}

export async function orderIsInActiveProduction(
  supabase: SupabaseClient,
  tenantId: string,
  orderId: string
): Promise<{ ok: true } | { error: string; status: number }> {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, column_id")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .is("removed_at", null)
    .maybeSingle();

  if (orderError) return { error: orderError.message, status: 500 };
  if (!order?.column_id) return { error: "Order not found", status: 404 };

  const { data: column, error: colError } = await supabase
    .from("board_columns")
    .select("name")
    .eq("id", order.column_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (colError) return { error: colError.message, status: 500 };
  if (!columnNameIsInProductionBoard(column?.name ?? null)) {
    return { error: "Order is not in production", status: 409 };
  }
  return { ok: true };
}
