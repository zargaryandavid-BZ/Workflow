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

/** Parse SKU rows for activity diffs without minting new ids. */
function parseSkusForActivityDiff(value: unknown): SkuItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (v): v is Record<string, unknown> =>
        typeof v === "object" && v !== null
    )
    .map((v) => ({
      id: typeof v.id === "string" ? v.id.trim() : "",
      name: typeof v.name === "string" ? v.name.trim() : "",
      qty:
        typeof v.qty === "number" && !Number.isNaN(v.qty)
          ? v.qty
          : v.qty === "" || v.qty === undefined || v.qty === null
            ? null
            : Number(v.qty),
    }))
    .map((s) => ({
      ...s,
      qty:
        s.qty != null && typeof s.qty === "number" && !Number.isNaN(s.qty)
          ? s.qty
          : null,
    }));
}

function skuActivityLabel(sku: SkuItem): string {
  const name = sku.name.trim() || "Untitled SKU";
  if (sku.qty != null) return `${name} (qty ${sku.qty})`;
  return name;
}

export type SkuActivityChange = {
  field: string;
  from?: unknown;
  to?: unknown;
};

/**
 * Human-readable SKU diffs for the order activity log
 * (added / removed / name / qty), instead of a generic "SKUs updated".
 */
export function describeSkuActivityChanges(
  oldSkusRaw: unknown,
  newSkusRaw: unknown
): SkuActivityChange[] {
  const oldSkus = parseSkusForActivityDiff(oldSkusRaw);
  const newSkus = parseSkusForActivityDiff(newSkusRaw);
  if (oldSkus.length === 0 && newSkus.length === 0) {
    return [];
  }
  if (JSON.stringify(oldSkus) === JSON.stringify(newSkus)) {
    return [];
  }

  const changes: SkuActivityChange[] = [];
  const oldById = new Map(oldSkus.filter((s) => s.id).map((s) => [s.id, s]));
  const newById = new Map(newSkus.filter((s) => s.id).map((s) => [s.id, s]));
  const matchedOldIds = new Set<string>();
  const matchedNewIds = new Set<string>();

  for (const [id, next] of newById) {
    const prev = oldById.get(id);
    if (!prev) continue;
    matchedOldIds.add(id);
    matchedNewIds.add(id);
    const label = next.name || prev.name || "SKU";
    if (prev.name !== next.name) {
      changes.push({
        field: "SKU name",
        from: prev.name || "(empty)",
        to: next.name || "(empty)",
      });
    }
    if (prev.qty !== next.qty) {
      changes.push({
        field: `SKU qty (${label})`,
        from: prev.qty ?? "(empty)",
        to: next.qty ?? "(empty)",
      });
    }
  }

  // Index-pair remaining rows (covers missing/unstable ids).
  const oldUnmatched = oldSkus.filter((s) => !s.id || !matchedOldIds.has(s.id));
  const newUnmatched = newSkus.filter((s) => !s.id || !matchedNewIds.has(s.id));
  const pairCount = Math.min(oldUnmatched.length, newUnmatched.length);

  for (let i = 0; i < pairCount; i++) {
    const prev = oldUnmatched[i]!;
    const next = newUnmatched[i]!;
    const label = next.name || prev.name || "SKU";
    if (prev.name !== next.name) {
      changes.push({
        field: "SKU name",
        from: prev.name || "(empty)",
        to: next.name || "(empty)",
      });
    }
    if (prev.qty !== next.qty) {
      changes.push({
        field: `SKU qty (${label})`,
        from: prev.qty ?? "(empty)",
        to: next.qty ?? "(empty)",
      });
    }
  }

  for (let i = pairCount; i < newUnmatched.length; i++) {
    changes.push({ field: "SKU added", to: skuActivityLabel(newUnmatched[i]!) });
  }
  for (let i = pairCount; i < oldUnmatched.length; i++) {
    changes.push({
      field: "SKU removed",
      to: skuActivityLabel(oldUnmatched[i]!),
    });
  }

  if (changes.length === 0) {
    if (oldSkus.length !== newSkus.length) {
      changes.push({
        field: "SKUs",
        from: oldSkus.length,
        to: newSkus.length,
      });
    } else {
      changes.push({ field: "SKUs updated" });
    }
  }

  return changes;
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
