import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { orderCardThumbnails } from "@/lib/board-order-enrichment";
import { firstThumbnailUrl } from "@/lib/card-image";
import {
  buildShippingStatusItems,
  shippingStatusKindForColumnName,
  splitShippingStatusItems,
  type ShippingStatusItem,
  type ShippingStatusRow,
} from "@/lib/shipping-status";

export interface ShippingStatusDashboardData {
  pickup: ShippingStatusItem[];
  delivery: ShippingStatusItem[];
  newCount: number;
}

export async function loadShippingStatusDashboard(
  client: SupabaseClient,
  tenantId: string
): Promise<ShippingStatusDashboardData> {
  const { data: columns, error: columnsError } = await client
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", tenantId);
  if (columnsError) throw columnsError;

  const statusColumnIds = (columns ?? [])
    .filter((column) => shippingStatusKindForColumnName(column.name))
    .map((column) => column.id);
  if (statusColumnIds.length === 0) {
    return { pickup: [], delivery: [], newCount: 0 };
  }

  const { data, error } = await client
    .from("shipping_requests")
    .select(
      `
        id,
        order_id,
        status,
        client_choice,
        fedex_selection,
        delivery_address,
        fedex_tracking_number,
        responded_at,
        created_at,
        shipping_status_seen_at,
        shipping_status_removed_at,
        order:orders!inner(
          id,
          title,
          specs,
          column_id,
          column:board_columns!inner(name),
          customer:customers(name)
        )
      `
    )
    .eq("tenant_id", tenantId)
    .eq("status", "client_responded")
    .in("order.column_id", statusColumnIds)
    .order("responded_at", { ascending: false, nullsFirst: false })
    .limit(500);

  if (error) throw error;

  const rows = (data ?? []) as unknown as ShippingStatusRow[];
  const ordersById = new Map<string, { id: string; specs: unknown }>();
  for (const row of rows) {
    const order = Array.isArray(row.order) ? row.order[0] : row.order;
    if (order) ordersById.set(order.id, { id: order.id, specs: order.specs });
  }
  const orders = [...ordersById.values()];
  const thumbnails = await orderCardThumbnails(client, orders);
  const items = buildShippingStatusItems(rows).map((item) => ({
    ...item,
    artworkUrl: firstThumbnailUrl(thumbnails[item.orderId]) ?? null,
  }));
  return {
    ...splitShippingStatusItems(items),
    newCount: items.filter((item) => item.isNew).length,
  };
}
