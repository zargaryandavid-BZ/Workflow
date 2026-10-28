import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeScanButtons,
  scanButtonsForStation,
} from "@/lib/fulfillment-scan-config";
import { boxLineQuantityFromScan } from "@/lib/multiitem-box-lookup";
import type { DeliveryEvent } from "@/lib/scan-delivery-history";

const MAX_DAYS = 365;
const PAGE = 1000;
const ORDER_CHUNK = 200;

export type DeliveryHistoryPayload = {
  columns: { id: string; name: string }[];
  events: DeliveryEvent[];
  items_by_order: Record<string, number>;
  /** Order number and customer for the per-period list. */
  order_info: Record<string, { title: string; customer: string | null }>;
};

export function deliveryHistoryDays(raw: string | null): number {
  return Math.min(MAX_DAYS, Math.max(1, Math.floor(Number(raw) || 30)));
}

/**
 * Orders moved into a Sender-station button's column (Scan → Sender), from
 * `activity_log` `moved` rows of any source (scan, board, automation). The
 * client buckets `events` by its own local day; `items_by_order` is each
 * order's item qty (same as Scan Total Qty).
 */
export async function loadDeliveryHistory(args: {
  supabase: SupabaseClient;
  tenantId: string;
  scanColumnConfig: unknown;
  days: number;
}): Promise<DeliveryHistoryPayload> {
  const { supabase, tenantId } = args;
  // One extra day so every client time zone sees its whole first day.
  const since = new Date(Date.now() - (args.days + 1) * 24 * 60 * 60 * 1000);

  const columnIds = [
    ...new Set(
      scanButtonsForStation(normalizeScanButtons(args.scanColumnConfig), "sender")
        .map((button) => button.columnId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  if (columnIds.length === 0) {
    return { columns: [], events: [], items_by_order: {}, order_info: {} };
  }

  const { data: columnRows } = await supabase
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .in("id", columnIds);
  const nameById = new Map(
    ((columnRows ?? []) as { id: string; name: string }[]).map((c) => [
      c.id,
      c.name,
    ])
  );
  const columns = columnIds.map((id) => ({
    id,
    name: nameById.get(id) ?? "Removed column",
  }));

  const events: DeliveryEvent[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("activity_log")
      .select("order_id, metadata, created_at")
      .eq("tenant_id", tenantId)
      .eq("action", "moved")
      .in("metadata->>to", columnIds)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as {
      order_id: string | null;
      metadata: { to?: unknown } | null;
      created_at: string;
    }[];
    for (const row of rows) {
      const to = row.metadata?.to;
      if (!row.order_id || typeof to !== "string") continue;
      events.push({ orderId: row.order_id, columnId: to, at: row.created_at });
    }
    if (rows.length < PAGE) break;
  }

  const orderIds = [...new Set(events.map((event) => event.orderId))];
  const { data: fieldRows } = await supabase
    .from("custom_fields")
    .select("id, name")
    .eq("tenant_id", tenantId);
  const fieldNameById = new Map(
    ((fieldRows ?? []) as { id: string; name: string }[]).map((f) => [
      f.id,
      f.name,
    ])
  );
  const itemsByOrder: Record<string, number> = {};
  const orderInfo: DeliveryHistoryPayload["order_info"] = {};
  for (let i = 0; i < orderIds.length; i += ORDER_CHUNK) {
    const chunk = orderIds.slice(i, i + ORDER_CHUNK);
    const [ordersRes, valuesRes] = await Promise.all([
      supabase
        .from("orders")
        .select("id, title, specs, customer:customers(name)")
        .eq("tenant_id", tenantId)
        .in("id", chunk),
      supabase
        .from("custom_field_values")
        .select("order_id, custom_field_id, value")
        .in("order_id", chunk),
    ]);
    const valuesByOrder = new Map<string, Record<string, unknown>>();
    for (const row of (valuesRes.data ?? []) as {
      order_id: string;
      custom_field_id: string;
      value: unknown;
    }[]) {
      const name = fieldNameById.get(row.custom_field_id);
      if (!name) continue;
      const named = valuesByOrder.get(row.order_id) ?? {};
      named[name] = row.value;
      valuesByOrder.set(row.order_id, named);
    }
    for (const order of (ordersRes.data ?? []) as {
      id: string;
      title: string;
      specs: Record<string, unknown> | null;
      customer: { name: string | null } | { name: string | null }[] | null;
    }[]) {
      const customer = Array.isArray(order.customer)
        ? order.customer[0]
        : order.customer;
      orderInfo[order.id] = {
        title: order.title,
        customer: customer?.name?.trim() || null,
      };
      itemsByOrder[order.id] = boxLineQuantityFromScan(
        order.specs,
        valuesByOrder.get(order.id) ?? {}
      );
    }
  }

  return { columns, events, items_by_order: itemsByOrder, order_info: orderInfo };
}
