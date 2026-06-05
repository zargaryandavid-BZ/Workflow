import type { Asset, Order } from "@/lib/types";
import { normalizeSkus, type SkuItem } from "@/lib/skus";

/** SKUs from order specs with stable ids */
export function orderSkus(order: Pick<Order, "specs">): SkuItem[] {
  return normalizeSkus(order.specs?.skus);
}

/** SKU rows with linked artwork assets for downstream stages */
export function skusWithArtwork(
  order: Pick<Order, "specs">,
  assets: Asset[]
) {
  const skus = orderSkus(order);
  const bySkuKey = new Map<string, Asset>();
  for (const a of assets) {
    if (a.sku_key) bySkuKey.set(a.sku_key, a);
  }
  return skus.map((sku) => ({
    ...sku,
    artwork: bySkuKey.get(sku.id) ?? null,
  }));
}
