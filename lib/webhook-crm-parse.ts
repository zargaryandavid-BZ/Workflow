/** CRM order webhook parse helpers (no app aliases — safe for node:test). */

export function parseWebhookNumericQty(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Print / item quantity for Order QTY.
 * Uses `order_qty` or `quantity`. Does **not** use `sku_qty` (SKU row count).
 * Falls back to the sum of SKU row quantities only when print qty is omitted.
 */
export function webhookPrintQty(
  spec: {
    order_qty?: unknown;
    quantity?: unknown;
    sku_qty?: unknown;
  },
  skus: { qty?: number | null }[]
): number | null {
  const explicit =
    parseWebhookNumericQty(spec.order_qty) ??
    parseWebhookNumericQty(spec.quantity);
  if (explicit != null) return explicit;
  const sum = skus.reduce(
    (acc, s) =>
      acc + (typeof s.qty === "number" && !Number.isNaN(s.qty) ? s.qty : 0),
    0
  );
  return sum > 0 ? sum : null;
}

function pickTrimmedNote(
  ...vals: (string | null | undefined)[]
): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** CRM ticket Attention / Internal Notes — top-level `notes` on every card. */
export function crmTicketStaffNote(order: {
  notes?: string | null;
  internal_note?: string | null;
}): string | null {
  return pickTrimmedNote(order.internal_note, order.notes);
}

/**
 * Production notes for one line. `line_item_comment` only.
 * Item `notes` / `description` are empty from CRM and must not be used.
 */
export function crmLineProductionNote(item: {
  production_notes?: string | null;
  notes_for_production?: string | null;
  line_item_comment?: string | null;
  line_comment?: string | null;
  comment?: string | null;
  notes?: string | null;
  description?: string | null;
}): string | null {
  return pickTrimmedNote(
    item.production_notes,
    item.notes_for_production,
    item.line_item_comment,
    item.line_comment,
    item.comment
  );
}

/** Append size/color breakdown when CRM sends `order_qty_details`. */
export function withOrderQtyDetails(
  production: string | null,
  orderQtyDetails?: string | null
): string | null {
  const details =
    typeof orderQtyDetails === "string" ? orderQtyDetails.trim() : "";
  if (!details) return production;
  if (production && production.includes(details)) return production;
  return [production, details].filter(Boolean).join("\n\n");
}
