/**
 * Combo stock check.
 *
 * A combo order (e.g. a bag/pouch + label) needs the base stock (the bag) on
 * hand before production runs it. When such a job is worked, we text the
 * warehouse (Jacob) to confirm stock. Jacob replies:
 *   1 = in stock, 2 = ordered, 3 = can't get.
 * The job is hard-blocked from leaving "In Progress" until the reply is 1 or 2
 * (or an admin/manager overrides).
 *
 * State lives on specs.combo_stock — additive, no migration.
 */
import type { CustomField, OrderWithRelations } from "@/lib/types";

export type ComboStockStatus =
  | "pending"
  | "in_stock"
  | "ordered"
  | "cant_get";

export interface ComboStock {
  status: ComboStockStatus;
  /** ISO — when Jacob was texted. */
  asked_at?: string | null;
  /** ISO — when Jacob replied (or a manager set it). */
  answered_at?: string | null;
  /** User id who overrode the move block, if any. */
  override_by?: string | null;
}

/** The warehouse contact the stock text goes to (Jacob). Overridable via env. */
export const COMBO_STOCK_PHONE =
  process.env.COMBO_STOCK_PHONE?.trim() || "+12133644941";
export const COMBO_STOCK_CONTACT_NAME =
  process.env.COMBO_STOCK_CONTACT_NAME?.trim() || "Jacob";

export const COMBO_STOCK_LABELS: Record<ComboStockStatus, string> = {
  pending: "Stock: waiting on warehouse",
  in_stock: "Stock: in stock",
  ordered: "Stock: ordered",
  cant_get: "Stock: can't get",
};

/** Statuses that let a combo job leave In Progress. */
export function comboStockConfirmed(
  status: ComboStockStatus | null | undefined
): boolean {
  return status === "in_stock" || status === "ordered";
}

export function getComboStock(order: {
  specs?: Record<string, unknown> | null;
}): ComboStock | null {
  const raw = order.specs?.combo_stock;
  if (!raw || typeof raw !== "object") return null;
  const status = (raw as ComboStock).status;
  if (
    status === "pending" ||
    status === "in_stock" ||
    status === "ordered" ||
    status === "cant_get"
  ) {
    return raw as ComboStock;
  }
  return null;
}

/** Map a warehouse SMS reply body to a status. Accepts "1"/"2"/"3" (loose). */
export function parseStockReply(body: string): ComboStockStatus | null {
  const t = body.trim().toLowerCase();
  if (/^1\b/.test(t) || t === "in stock" || t === "yes") return "in_stock";
  if (/^2\b/.test(t) || t === "ordered") return "ordered";
  if (/^3\b/.test(t) || t === "can't get" || t === "cant get" || t === "no")
    return "cant_get";
  return null;
}

/**
 * Whether this order is a combo (base stock + print). Matches the same signal
 * the board's application guard uses: "combo" in the item title, order title,
 * the Product field, or any custom-field value.
 */
export function isComboOrder(
  order: { title?: string; specs?: Record<string, unknown> | null },
  fieldValues: Record<string, unknown>,
  customFields: CustomField[]
): boolean {
  const itemTitle =
    typeof order.specs?.webhook_item_title === "string"
      ? order.specs.webhook_item_title
      : "";
  if (/combo/i.test(itemTitle)) return true;
  if (order.title && /combo/i.test(order.title)) return true;
  const productField = customFields.find(
    (f) => f.name.toLowerCase() === "product"
  );
  if (productField) {
    const v = fieldValues[productField.id];
    if (typeof v === "string" && /combo/i.test(v)) return true;
  }
  return Object.values(fieldValues).some(
    (v) => typeof v === "string" && /combo/i.test(v)
  );
}

/** The text sent to the warehouse contact. */
export function buildComboStockSms(
  orderNumber: string,
  product: string
): string {
  const item = product?.trim() ? ` (${product.trim()})` : "";
  return (
    `Bazaar stock check — combo order ${orderNumber}${item}. ` +
    `Reply 1 = in stock, 2 = ordered, 3 = can't get.`
  );
}

/** Merge a new combo_stock state onto existing specs (immutably). */
export function withComboStock(
  specs: Record<string, unknown> | null | undefined,
  stock: ComboStock | null
): Record<string, unknown> {
  const next = { ...(specs ?? {}) };
  if (stock) next.combo_stock = stock;
  else delete next.combo_stock;
  return next;
}
