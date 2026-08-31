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
