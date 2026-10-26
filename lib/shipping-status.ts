import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FedExRateOption,
  ShippingClientChoice,
  ShippingDeliveryAddress,
} from "@/lib/types";

export type ShippingStatusKind = "pickup" | "delivery";

export interface ShippingStatusItem {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  kind: ShippingStatusKind;
  respondedAt: string;
  isNew: boolean;
  serviceName: string | null;
  trackingNumber: string | null;
  deliveryAddress: ShippingDeliveryAddress | null;
}

export interface ShippingStatusRow {
  id: string;
  order_id: string;
  status: string;
  client_choice: ShippingClientChoice | null;
  fedex_selection: FedExRateOption | null;
  delivery_address: ShippingDeliveryAddress | null;
  fedex_tracking_number: string | null;
  responded_at: string | null;
  created_at: string;
  shipping_status_seen_at: string | null;
  shipping_status_removed_at: string | null;
  order:
    | {
        id: string;
        title: string;
        customer:
          | { name: string | null }
          | { name: string | null }[]
          | null;
      }
    | {
        id: string;
        title: string;
        customer:
          | { name: string | null }
          | { name: string | null }[]
          | null;
      }[]
    | null;
}

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function responseTime(row: ShippingStatusRow): string {
  return row.responded_at ?? row.created_at;
}

/**
 * One active row per order. The latest customer response supersedes every
 * earlier request, including when the latest one was manually completed.
 */
export function buildShippingStatusItems(
  rows: ShippingStatusRow[]
): ShippingStatusItem[] {
  const latestByOrder = new Map<string, ShippingStatusRow>();
  const newestFirst = [...rows].sort(
    (a, b) =>
      new Date(responseTime(b)).getTime() -
      new Date(responseTime(a)).getTime()
  );

  for (const row of newestFirst) {
    if (!latestByOrder.has(row.order_id)) {
      latestByOrder.set(row.order_id, row);
    }
  }

  const items: ShippingStatusItem[] = [];
  for (const row of latestByOrder.values()) {
    if (
      row.status !== "client_responded" ||
      row.shipping_status_removed_at ||
      (row.client_choice !== "pickup" && row.client_choice !== "delivery")
    ) {
      continue;
    }
    const order = relatedOne(row.order);
    const customer = relatedOne(order?.customer);
    items.push({
      id: row.id,
      orderId: row.order_id,
      orderNumber: order?.title?.trim() || "Untitled order",
      customerName: customer?.name?.trim() || null,
      kind: row.client_choice,
      respondedAt: responseTime(row),
      isNew: !row.shipping_status_seen_at,
      serviceName:
        row.client_choice === "delivery"
          ? row.fedex_selection?.serviceName?.trim() || "FedEx Delivery"
          : null,
      trackingNumber:
        row.client_choice === "delivery"
          ? row.fedex_tracking_number?.trim() || null
          : null,
      deliveryAddress:
        row.client_choice === "delivery" ? row.delivery_address : null,
    });
  }
  return items;
}

export function splitShippingStatusItems(items: ShippingStatusItem[]): {
  pickup: ShippingStatusItem[];
  delivery: ShippingStatusItem[];
} {
  return {
    pickup: items.filter((item) => item.kind === "pickup"),
    delivery: items.filter((item) => item.kind === "delivery"),
  };
}

export function shouldAutoRemoveShippingStatus(args: {
  choice: ShippingClientChoice | null | undefined;
  event: "pickup_confirmed" | "entered_fulfilled";
}): boolean {
  return (
    (args.event === "pickup_confirmed" && args.choice === "pickup") ||
    (args.event === "entered_fulfilled" && args.choice === "delivery")
  );
}

export async function removeShippingStatusForOrder(
  client: SupabaseClient,
  args: {
    tenantId: string;
    orderId: string;
    choice: "pickup" | "delivery";
    reason: "pickup_confirmed" | "fulfilled_scan";
  }
): Promise<void> {
  const { error } = await client
    .from("shipping_requests")
    .update({
      shipping_status_removed_at: new Date().toISOString(),
      shipping_status_removed_reason: args.reason,
    })
    .eq("tenant_id", args.tenantId)
    .eq("order_id", args.orderId)
    .eq("status", "client_responded")
    .eq("client_choice", args.choice)
    .is("shipping_status_removed_at", null);

  if (error) throw error;
}
