/** Per-board-column card sort modes (Kanban + table). */

export type ColumnSortMode =
  | "manual"
  | "moved_desc"
  | "moved_asc"
  | "created_desc"
  | "created_asc"
  | "due_asc"
  | "due_desc"
  | "title_asc"
  | "title_desc";

/** Default when nothing saved: moved date newest → oldest. */
export const DEFAULT_COLUMN_SORT: ColumnSortMode = "moved_desc";

export const COLUMN_SORT_OPTIONS: {
  value: ColumnSortMode;
  label: string;
}[] = [
  { value: "manual", label: "Manual order" },
  { value: "moved_desc", label: "Moved: new → old" },
  { value: "moved_asc", label: "Moved: old → new" },
  { value: "created_desc", label: "Created: new → old" },
  { value: "created_asc", label: "Created: old → new" },
  { value: "due_asc", label: "Due: earliest first" },
  { value: "due_desc", label: "Due: latest first" },
  { value: "title_asc", label: "Order #: A → Z" },
  { value: "title_desc", label: "Order #: Z → A" },
];

const MODES = new Set<ColumnSortMode>(
  COLUMN_SORT_OPTIONS.map((o) => o.value)
);

export function isColumnSortMode(value: unknown): value is ColumnSortMode {
  return typeof value === "string" && MODES.has(value as ColumnSortMode);
}

export function boardColumnSortStorageKey(tenantId: string): string {
  return `board-column-sort-${tenantId}`;
}

export type ColumnSortMap = Record<string, ColumnSortMode>;

export function loadColumnSortMap(tenantId: string): ColumnSortMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(boardColumnSortStorageKey(tenantId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: ColumnSortMap = {};
    for (const [id, mode] of Object.entries(parsed as Record<string, unknown>)) {
      if (isColumnSortMode(mode)) out[id] = mode;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveColumnSortMap(tenantId: string, map: ColumnSortMap): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      boardColumnSortStorageKey(tenantId),
      JSON.stringify(map)
    );
  } catch {
    // ignore quota / private mode
  }
}

export function getColumnSortMode(
  map: ColumnSortMap,
  columnId: string
): ColumnSortMode {
  return map[columnId] ?? DEFAULT_COLUMN_SORT;
}

function timeMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function dueDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  return day || null;
}

/**
 * Sort orders for display in a board column.
 * - manual: position ascending
 * - due_*: null due dates sort to the top
 * - moved_*: falls back to created_at when last_moved_at is missing
 */
export function sortOrdersForColumn<
  T extends {
    id: string;
    title: string;
    position: number;
    created_at: string;
    due_date: string | null;
    last_moved_at?: string | null;
  },
>(orders: T[], mode: ColumnSortMode): T[] {
  const list = [...orders];

  if (mode === "manual") {
    return list.sort((a, b) => a.position - b.position);
  }

  if (mode === "title_asc" || mode === "title_desc") {
    const dir = mode === "title_asc" ? 1 : -1;
    return list.sort((a, b) => {
      const cmp = a.title.localeCompare(b.title, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      if (cmp !== 0) return cmp * dir;
      return a.position - b.position;
    });
  }

  if (mode === "due_asc" || mode === "due_desc") {
    const dir = mode === "due_asc" ? 1 : -1;
    return list.sort((a, b) => {
      const da = dueDay(a.due_date);
      const db = dueDay(b.due_date);
      // Null due dates at the top.
      if (!da && !db) return a.position - b.position;
      if (!da) return -1;
      if (!db) return 1;
      const cmp = da.localeCompare(db);
      if (cmp !== 0) return cmp * dir;
      return a.position - b.position;
    });
  }

  if (mode === "created_asc" || mode === "created_desc") {
    const dir = mode === "created_asc" ? 1 : -1;
    return list.sort((a, b) => {
      const ta = timeMs(a.created_at) ?? 0;
      const tb = timeMs(b.created_at) ?? 0;
      if (ta !== tb) return (ta - tb) * dir;
      return a.position - b.position;
    });
  }

  // moved_asc / moved_desc (default)
  const dir = mode === "moved_asc" ? 1 : -1;
  return list.sort((a, b) => {
    const ta = timeMs(a.last_moved_at) ?? timeMs(a.created_at) ?? 0;
    const tb = timeMs(b.last_moved_at) ?? timeMs(b.created_at) ?? 0;
    if (ta !== tb) return (ta - tb) * dir;
    return a.position - b.position;
  });
}
