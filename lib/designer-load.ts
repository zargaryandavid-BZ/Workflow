/**
 * Designer "load" = active jobs in Start + In Progress board columns.
 * Shown as Name (Y)/Z where Y = cards and Z = SKU rows on those cards.
 */

export interface DesignerLoadStats {
  /** Active cards (orders) assigned to the designer. */
  load: number;
  /** Total SKU line items across those cards. */
  skuCount: number;
}

export function isDesignerLoadColumn(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  if (isStartColumn(name)) return true;
  if (isInProgressColumn(name)) return true;
  return false;
}

/** True for Start stage columns. */
export function isStartColumn(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  return /\bstart\b/.test(n);
}

/** True for In Progress stage columns (not Start / Hold / production). */
export function isInProgressColumn(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  if (/\bin[\s-]*progress\b/.test(n)) return true;
  if (n === "progress") return true;
  return false;
}

export function designerLoadColumnIds(
  columns: { id: string; name: string }[]
): string[] {
  return columns.filter((c) => isDesignerLoadColumn(c.name)).map((c) => c.id);
}

export function inProgressColumnIds(
  columns: { id: string; name: string }[]
): string[] {
  return columns.filter((c) => isInProgressColumn(c.name)).map((c) => c.id);
}

function skuRowCountFromSpecs(specs: Record<string, unknown> | null | undefined): number {
  const raw = specs && typeof specs === "object" ? specs.skus : null;
  return Array.isArray(raw) ? raw.length : 0;
}

/** Count SKU line items on an order (same basis as designer load). */
export function designerSkuRowCount(specs: unknown): number {
  if (!specs || typeof specs !== "object") return 0;
  return skuRowCountFromSpecs(specs as Record<string, unknown>);
}

/** Count cards + SKU rows per designer_id among orders in the given column ids. */
export function countDesignerLoads(
  designerIds: string[],
  orders: {
    column_id: string;
    specs?: Record<string, unknown> | null;
  }[],
  loadColumnIds: Iterable<string>
): Map<string, DesignerLoadStats> {
  const loadSet =
    loadColumnIds instanceof Set ? loadColumnIds : new Set(loadColumnIds);
  const counts = new Map<string, DesignerLoadStats>();
  for (const id of designerIds) counts.set(id, { load: 0, skuCount: 0 });
  if (loadSet.size === 0) return counts;

  for (const order of orders) {
    if (!loadSet.has(order.column_id)) continue;
    const designerId =
      typeof order.specs?.designer_id === "string"
        ? order.specs.designer_id.trim()
        : "";
    if (!designerId || !counts.has(designerId)) continue;
    const current = counts.get(designerId)!;
    counts.set(designerId, {
      load: current.load + 1,
      skuCount: current.skuCount + skuRowCountFromSpecs(order.specs),
    });
  }
  return counts;
}

/**
 * Most available designer: fewest open cards, then fewest SKU rows, then pool
 * order (stable). Returns null for an empty pool.
 */
export function pickLeastLoadedDesigner(
  pool: string[],
  loads: Map<string, DesignerLoadStats>
): string | null {
  let best: string | null = null;
  let bestStats: DesignerLoadStats | null = null;
  for (const id of pool) {
    const stats = loads.get(id) ?? { load: 0, skuCount: 0 };
    if (
      !bestStats ||
      stats.load < bestStats.load ||
      (stats.load === bestStats.load && stats.skuCount < bestStats.skuCount)
    ) {
      best = id;
      bestStats = stats;
    }
  }
  return best;
}

/**
 * The designer every line of one order (xxx-1, xxx-2, …) should share: the one
 * already on existing sibling cards, else the first line that names one.
 * Null means none is known yet (auto-assign may pick one).
 */
export function orderGroupDesignerId(
  siblingDesignerIds: (string | null | undefined)[],
  lineDesignerIds: (string | null | undefined)[]
): string | null {
  const first = (ids: (string | null | undefined)[]) =>
    ids.map((id) => (typeof id === "string" ? id.trim() : "")).find(Boolean) ??
    null;
  return first(siblingDesignerIds) ?? first(lineDesignerIds);
}

/** Format for selects/menus: `Manny (3)/8` */
export function formatDesignerOptionLabel(
  name: string,
  load: number | undefined,
  skuCount: number | undefined = 0
): string {
  const cards = typeof load === "number" ? load : 0;
  const skus = typeof skuCount === "number" ? skuCount : 0;
  return `${name} (${cards})/${skus}`;
}

/** Compact load suffix used next to a name: `(3)/8` */
export function formatDesignerLoadSuffix(
  load: number | undefined,
  skuCount: number | undefined = 0
): string {
  const cards = typeof load === "number" ? load : 0;
  const skus = typeof skuCount === "number" ? skuCount : 0;
  return `(${cards})/${skus}`;
}

/** Busiest first (cards, then SKU rows), then name. */
export function sortDesignersByLoad<
  T extends { name: string; load?: number; skuCount?: number },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const loadA = a.load ?? 0;
    const loadB = b.load ?? 0;
    if (loadB !== loadA) return loadB - loadA;
    const skuA = a.skuCount ?? 0;
    const skuB = b.skuCount ?? 0;
    if (skuB !== skuA) return skuB - skuA;
    return a.name.localeCompare(b.name);
  });
}
