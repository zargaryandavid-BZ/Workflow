export interface SkuItem {
  /** Stable id for linking artwork in assets.sku_key */
  id: string;
  name: string;
  qty: number | null;
}

function newSkuId() {
  return crypto.randomUUID();
}

export function normalizeSkus(value: unknown): SkuItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (v): v is Record<string, unknown> =>
        typeof v === "object" && v !== null
    )
    .map((v) => ({
      id: typeof v.id === "string" && v.id.trim() ? v.id : newSkuId(),
      name: typeof v.name === "string" ? v.name : "",
      qty:
        typeof v.qty === "number"
          ? v.qty
          : v.qty === "" || v.qty === undefined || v.qty === null
            ? null
            : Number(v.qty),
    }));
}

/** Ensures every SKU has an id before persisting to orders.specs.skus */
export function prepareSkusForSave(skus: SkuItem[]): SkuItem[] {
  return skus
    .filter((s) => s.name.trim() || s.qty != null)
    .map((s) => ({
      ...s,
      id: s.id.trim() ? s.id : newSkuId(),
      name: s.name.trim(),
    }));
}

export function skuIds(skus: SkuItem[]): string[] {
  return skus.map((s) => s.id);
}
