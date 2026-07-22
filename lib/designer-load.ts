/**
 * Designer "load" = active jobs in Start + In Progress board columns.
 */

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

/** Count jobs per designer_id among orders in the given column ids. */
export function countDesignerLoads(
  designerIds: string[],
  orders: {
    column_id: string;
    specs?: Record<string, unknown> | null;
  }[],
  loadColumnIds: Iterable<string>
): Map<string, number> {
  const loadSet = loadColumnIds instanceof Set
    ? loadColumnIds
    : new Set(loadColumnIds);
  const counts = new Map<string, number>();
  for (const id of designerIds) counts.set(id, 0);
  if (loadSet.size === 0) return counts;

  for (const order of orders) {
    if (!loadSet.has(order.column_id)) continue;
    const designerId =
      typeof order.specs?.designer_id === "string"
        ? order.specs.designer_id.trim()
        : "";
    if (!designerId || !counts.has(designerId)) continue;
    counts.set(designerId, (counts.get(designerId) ?? 0) + 1);
  }
  return counts;
}

export function formatDesignerOptionLabel(
  name: string,
  load: number | undefined
): string {
  const n = typeof load === "number" ? load : 0;
  return `${name} ${n}`;
}
