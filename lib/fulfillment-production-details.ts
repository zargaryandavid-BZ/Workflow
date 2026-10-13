import { normalizeSkus } from "./skus.ts";

export interface ProductionSkuDetail {
  label: string;
  quantity: number | null;
  artwork_url: string | null;
}

export interface ProductionOrderDetails {
  product_type: string;
  sku_count: number;
  total_qty: number;
  sku_details: ProductionSkuDetail[];
}

function positiveInteger(value: unknown): number {
  const parsed = Math.floor(Number(value) || 0);
  return parsed > 0 ? parsed : 0;
}

function productTypeFromSkuName(name: string): string {
  const product = name.split(/\s+[–—-]\s+/)[0]?.trim() ?? "";
  return /^sku\s*\d*$/i.test(product) ? "" : product;
}

export function productionOrderDetails(
  specs: Record<string, unknown> | null | undefined,
  fallbackProduct: string,
  artworkUrls: string[],
  finalArtworkSkuCount?: number | null
): ProductionOrderDetails {
  const skus = normalizeSkus(specs?.skus);
  const configuredCount = positiveInteger(specs?.sku_qty);
  const skuCount =
    configuredCount ||
    positiveInteger(finalArtworkSkuCount) ||
    skus.length ||
    artworkUrls.length;
  const totalQty = skus.reduce(
    (sum, sku) => sum + positiveInteger(sku.qty),
    0
  );
  const productType =
    skus.map((sku) => productTypeFromSkuName(sku.name)).find(Boolean) ??
    fallbackProduct.trim();

  const aggregateQty =
    skuCount > 0 && totalQty > 0 && totalQty % skuCount === 0
      ? totalQty / skuCount
      : null;

  return {
    product_type: productType || "—",
    sku_count: skuCount,
    total_qty: totalQty,
    sku_details: Array.from({ length: skuCount }, (_, index) => ({
      label: `SKU ${index + 1}`,
      quantity:
        skus.length === skuCount
          ? positiveInteger(skus[index]?.qty) || null
          : aggregateQty,
      artwork_url: artworkUrls[index] ?? null,
    })),
  };
}
