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
export function prepareSkusForSave(
  skus: SkuItem[],
  options?: { pendingArtworkIds?: Iterable<string> }
): SkuItem[] {
  const pending = new Set(options?.pendingArtworkIds ?? []);
  return skus
    .filter(
      (s) => s.name.trim() || s.qty != null || pending.has(s.id)
    )
    .map((s) => ({
      id: s.id.trim() ? s.id : newSkuId(),
      name: s.name.trim(),
      qty:
        typeof s.qty === "number" && !Number.isNaN(s.qty) ? s.qty : null,
    }));
}

/** Restore SKU rows from artwork assets when specs.skus was saved without them. */
export function mergeSkusWithAssets(
  skus: SkuItem[],
  assets: { sku_key: string | null }[]
): SkuItem[] {
  const byId = new Map(skus.map((s) => [s.id, s]));
  for (const asset of assets) {
    if (asset.sku_key && !byId.has(asset.sku_key)) {
      byId.set(asset.sku_key, {
        id: asset.sku_key,
        name: "",
        qty: null,
      });
    }
  }
  return [...byId.values()];
}

export function validateSkus(
  skus: SkuItem[],
  pendingArtworkIds: Iterable<string> = []
): string | null {
  const pending = new Set(pendingArtworkIds);

  for (let i = 0; i < skus.length; i++) {
    const s = skus[i];
    const hasContent =
      Boolean(s.name.trim()) || s.qty != null || pending.has(s.id);
    if (!hasContent) continue;

    if (!s.name.trim()) {
      return `SKU ${i + 1}: name is required.`;
    }
    if (
      s.qty == null ||
      typeof s.qty !== "number" ||
      Number.isNaN(s.qty) ||
      s.qty < 1
    ) {
      return `SKU ${i + 1}: quantity is required (minimum 1).`;
    }
  }

  for (const skuId of pending) {
    if (!skus.some((s) => s.id === skuId)) {
      return "Artwork is attached to a SKU row that was removed.";
    }
  }

  return null;
}

export function skuIds(skus: SkuItem[]): string[] {
  return skus.map((s) => s.id);
}

/** Count of SKU rows on an order (read-only, no id generation). */
export function skuCountFromSpecs(specs: unknown): number {
  const raw =
    specs && typeof specs === "object" && specs !== null && "skus" in specs
      ? (specs as { skus?: unknown }).skus
      : null;
  return Array.isArray(raw) ? raw.length : 0;
}

/** Sum of SKU quantities on an order (read-only, no id generation). */
export function skuQtySumFromSpecs(specs: unknown): number {
  const raw =
    specs && typeof specs === "object" && specs !== null && "skus" in specs
      ? (specs as { skus?: unknown }).skus
      : null;
  if (!Array.isArray(raw)) return 0;
  return raw.reduce((sum, item) => {
    if (!item || typeof item !== "object") return sum;
    const qty = (item as { qty?: unknown }).qty;
    if (typeof qty === "number" && !Number.isNaN(qty)) return sum + qty;
    if (qty !== null && qty !== undefined && qty !== "") {
      const n = Number(qty);
      if (!Number.isNaN(n)) return sum + n;
    }
    return sum;
  }, 0);
}
