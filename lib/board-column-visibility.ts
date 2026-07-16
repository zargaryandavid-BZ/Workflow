export function boardHiddenColsStorageKey(tenantId: string): string {
  return `board-hidden-cols-${tenantId}`;
}

export function loadHiddenColumnIds(tenantId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = localStorage.getItem(boardHiddenColsStorageKey(tenantId));
    if (!stored) return new Set();
    const ids = JSON.parse(stored) as string[];
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

export function saveHiddenColumnIds(tenantId: string, ids: Set<string>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    boardHiddenColsStorageKey(tenantId),
    JSON.stringify([...ids])
  );
}
