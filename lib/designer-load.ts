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
  if (n.includes("start")) return true;
  if (/\bin[\s-]*progress\b/.test(n)) return true;
  if (n === "progress") return true;
  return false;
}

export function designerLoadColumnIds(
  columns: { id: string; name: string }[]
): string[] {
  return columns.filter((c) => isDesignerLoadColumn(c.name)).map((c) => c.id);
}

function skuRowCountFromSpecs(specs: Record<string, unknown> | null | undefined): number {
  const raw = specs && typeof specs === "object" ? specs.skus : null;
  return Array.isArray(raw) ? raw.length : 0;
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
