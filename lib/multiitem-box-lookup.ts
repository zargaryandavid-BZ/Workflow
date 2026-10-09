import type { SupabaseClient } from "@supabase/supabase-js";
import {
  mergeScanNamedValues,
  pickScannedOrder,
  sanitizeScanLookupToken,
  scanQtyFromSpecs,
  specValueByNames,
} from "./fulfillment-scan-order.ts";
import { normalizeSkus, skuQtySumFromSpecs } from "./skus.ts";

export type MultiitemBoxRow = {
  id: string;
  box_name: string;
  box_number: number;
  box_date: string;
  po_number: string | null;
  size_label: string | null;
  weight_lbs: number | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  status: string;
  created_at: string;
  saved_at: string | null;
  multiitem_box_orders?: MultiitemBoxOrderRow[] | null;
};

export type MultiitemBoxOrderRow = {
  id: string;
  box_id: string;
  order_id: string;
  order_title: string;
  item_title?: string | null;
  customer_name: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  quantity: number;
  added_at: string;
  thumbnail_url?: string | null;
};

type OrderLookupRow = {
  id: string;
  title: string;
  specs: Record<string, unknown> | null;
  customer: { name: string | null } | { name: string | null }[] | null;
};

export function nestedCustomerName(raw: OrderLookupRow["customer"]): string {
  const row = Array.isArray(raw) ? raw[0] : raw;
  const name = row?.name?.trim();
  return name || "";
}

export function boxLineQuantityFromScan(
  specs: Record<string, unknown> | null | undefined,
  fieldValuesByName: Record<string, unknown> = {}
): number {
  const sku = skuQtySumFromSpecs(specs);
  if (sku > 0) return Math.floor(sku);
  const named = mergeScanNamedValues(specs, fieldValuesByName);
  const qty = scanQtyFromSpecs(specs, named);
  if (qty != null && qty > 0) return Math.floor(qty);
  return 1;
}

/** Job-ticket qty minus what is already in other boxes. */
export function remainingTicketQuantity(
  ticketQty: number,
  packedQty: number
): number {
  const ticket = Math.max(0, Math.floor(Number(ticketQty) || 0));
  const packed = Math.max(0, Math.floor(Number(packedQty) || 0));
  return Math.max(0, ticket - packed);
}

export function clampBoxLineToTicket(args: {
  requested?: number | null;
  ticketQty: number;
  packedElsewhere: number;
}): { quantity: number; ticketQty: number; remaining: number } | { error: string } {
  const ticketQty = Math.max(0, Math.floor(Number(args.ticketQty) || 0));
  const packedElsewhere = Math.max(
    0,
    Math.floor(Number(args.packedElsewhere) || 0)
  );
  const remaining = remainingTicketQuantity(ticketQty, packedElsewhere);
  if (remaining <= 0) {
    return {
      error: `Already boxed ${packedElsewhere} of ${ticketQty} (job ticket)`,
    };
  }
  const requested =
    args.requested == null || args.requested === undefined
      ? remaining
      : Math.floor(Number(args.requested) || 0);
  if (requested < 1) {
    return { error: "quantity must be at least 1" };
  }
  if (requested > remaining) {
    return {
      error: `Only ${remaining} left of ${ticketQty} on the job ticket`,
    };
  }
  return { quantity: requested, ticketQty, remaining };
}

export async function packedBoxQuantityForOrder(
  supabase: SupabaseClient,
  tenantId: string,
  orderId: string,
  excludeBoxId?: string | null
): Promise<number> {
  const { data, error } = await supabase
    .from("multiitem_box_orders")
    .select("quantity, box_id")
    .eq("tenant_id", tenantId)
    .eq("order_id", orderId);
  if (error) throw new Error(error.message);
  let total = 0;
  for (const row of data ?? []) {
    if (excludeBoxId && row.box_id === excludeBoxId) continue;
    const n = Math.floor(Number(row.quantity) || 0);
    if (n > 0) total += n;
  }
  return total;
}

const ITEM_TITLE_KEYS = [
  "webhook_item_title",
  "webhook_order_title",
  "line_item_name",
  "line item name",
  "item_name",
  "item name",
  "line_item",
  "line item",
  "job_name",
  "job name",
];

export function boxLineItemTitleFromScan(
  specs: Record<string, unknown> | null | undefined,
  fieldValuesByName: Record<string, unknown> = {}
): string {
  const named = mergeScanNamedValues(specs, fieldValuesByName);
  const fromLine = specValueByNames(named, ITEM_TITLE_KEYS);
  if (fromLine) return fromLine;
  const fromProduct = specValueByNames(named, ["product"]);
  if (fromProduct) return fromProduct;
  const skuNames = normalizeSkus(
    specs && typeof specs === "object" && specs !== null && "skus" in specs
      ? (specs as { skus?: unknown }).skus
      : null
  )
    .map((s) => s.name.trim())
    .filter(Boolean);
  return skuNames.join(", ");
}

function fieldValuesByNameFromRows(
  fields: { id: string; name: string }[],
  values: { custom_field_id: string; value: unknown }[]
): Record<string, unknown> {
  const fieldNameById = new Map(fields.map((f) => [f.id, f.name]));
  const fieldValuesByName: Record<string, unknown> = {};
  for (const row of values) {
    const name = fieldNameById.get(row.custom_field_id);
    if (!name) continue;
    fieldValuesByName[name] = row.value;
  }
  return fieldValuesByName;
}

export async function resolveBoxLineDetails(
  supabase: SupabaseClient,
  tenantId: string,
  orderId: string,
  specs: Record<string, unknown> | null | undefined
): Promise<{ quantity: number; itemTitle: string }> {
  const [fieldsRes, valuesRes] = await Promise.all([
    supabase.from("custom_fields").select("id, name").eq("tenant_id", tenantId),
    supabase
      .from("custom_field_values")
      .select("custom_field_id, value")
      .eq("order_id", orderId),
  ]);
  const fieldValuesByName = fieldValuesByNameFromRows(
    (fieldsRes.data ?? []) as { id: string; name: string }[],
    (valuesRes.data ?? []) as { custom_field_id: string; value: unknown }[]
  );
  return {
    quantity: boxLineQuantityFromScan(specs, fieldValuesByName),
    itemTitle: boxLineItemTitleFromScan(specs, fieldValuesByName),
  };
}

export async function resolveBoxLineQuantity(
  supabase: SupabaseClient,
  tenantId: string,
  orderId: string,
  specs: Record<string, unknown> | null | undefined
): Promise<number> {
  const details = await resolveBoxLineDetails(
    supabase,
    tenantId,
    orderId,
    specs
  );
  return details.quantity;
}

export async function findTenantOrderByScan(
  supabase: SupabaseClient,
  tenantId: string,
  query: string
): Promise<{
  id: string;
  title: string;
  customerName: string;
  specs: Record<string, unknown> | null;
} | null> {
  const lookupToken = sanitizeScanLookupToken(query);
  if (!lookupToken) return null;

  const orderSelect =
    "id, title, specs, customer:customers(name)";

  const { data: exactRows, error: exactError } = await supabase
    .from("orders")
    .select(orderSelect)
    .eq("tenant_id", tenantId)
    .is("removed_at", null)
    .or(
      `title.eq.${lookupToken},specs->>webhook_order_number.eq.${lookupToken}`
    );

  if (exactError) throw new Error(exactError.message);

  let order = pickScannedOrder((exactRows ?? []) as OrderLookupRow[], query);

  if (!order) {
    const { data: fuzzyRows, error: fuzzyError } = await supabase
      .from("orders")
      .select(orderSelect)
      .eq("tenant_id", tenantId)
      .is("removed_at", null)
      .or(
        `title.ilike.%${lookupToken}%,specs->>webhook_order_number.ilike.%${lookupToken}%`
      )
      .limit(40);
    if (fuzzyError) throw new Error(fuzzyError.message);
    order = pickScannedOrder((fuzzyRows ?? []) as OrderLookupRow[], query);
  }

  if (!order) return null;
  return {
    id: order.id,
    title: order.title,
    customerName: nestedCustomerName(order.customer),
    specs: (order.specs ?? null) as Record<string, unknown> | null,
  };
}
