import { parseCatalogV2, type CatalogV2Product } from "./crm-catalog-v2.ts";
import {
  rawV2ProductFromInfo,
  type CatalogProductInfo,
} from "./product-field-rules.ts";

/**
 * Admin "+ New card": turn a live /api/crm-catalog product into the
 * CatalogV2Product the connected create path already uses (buildCrmSnapshot),
 * so POST /api/orders receives the same crm_snapshot shape as before.
 */
export function catalogV2ProductFromInfo(
  product: CatalogProductInfo,
): CatalogV2Product | null {
  const parsed = parseCatalogV2({
    schema_version: 2,
    products: [rawV2ProductFromInfo(product)],
  });
  return parsed.products[0] ?? null;
}
