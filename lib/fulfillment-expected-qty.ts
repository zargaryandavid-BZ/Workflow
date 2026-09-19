import { skuQtySumFromSpecs } from "./skus.ts";
import { webhookPrintQty } from "./webhook-crm-parse.ts";

function skuLineQty(item: unknown): number {
  if (!item || typeof item !== "object") return 0;
  const rec = item as { qty?: unknown; quantity?: unknown };
  const raw = rec.qty ?? rec.quantity;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function skuQtySumIncludingQuantity(specs: unknown): number {
  const fromQty = skuQtySumFromSpecs(specs);
  if (fromQty > 0) return fromQty;
  const raw =
    specs && typeof specs === "object" && specs !== null && "skus" in specs
      ? (specs as { skus?: unknown }).skus
      : null;
  if (!Array.isArray(raw)) return 0;
  return raw.reduce((sum, item) => sum + skuLineQty(item), 0);
}

/** Packed-item count for a scanned order (SKU qty, then print qty). Never 0. */
export function fulfillmentExpectedQty(specs: unknown): number {
  const skuSum = skuQtySumIncludingQuantity(specs);
  if (skuSum > 0) return Math.floor(skuSum);

  const rec =
    specs && typeof specs === "object" && specs !== null
      ? (specs as {
          order_qty?: unknown;
          quantity?: unknown;
          qty?: unknown;
        })
      : {};
  const print = webhookPrintQty(rec, []);
  if (print != null && print > 0) return Math.floor(print);

  const qty = Number(rec.qty);
  if (Number.isFinite(qty) && qty > 0) return Math.floor(qty);

  return 1;
}

export function fulfillmentDisplayQty(
  quantityExpected: number | null | undefined,
  specs: unknown
): number {
  if (
    typeof quantityExpected === "number" &&
    Number.isFinite(quantityExpected) &&
    quantityExpected > 0
  ) {
    return Math.floor(quantityExpected);
  }
  return fulfillmentExpectedQty(specs);
}
