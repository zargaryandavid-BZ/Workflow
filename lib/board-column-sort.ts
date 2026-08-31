/** Per-board-column card sort modes (Kanban + table). */

import { priorityScoreFromSpecs } from "@/lib/order-priority-score";

export type ColumnSortMode =
  | "manual"
  | "moved_desc"
  | "moved_asc"
  | "created_desc"
  | "created_asc"
  | "due_asc"
  | "due_desc"
  | "title_asc"
  | "title_desc"
  | "priority_desc"
  | "priority_asc";

/** Default when nothing saved: moved date newest → oldest. */
export const DEFAULT_COLUMN_SORT: ColumnSortMode = "moved_desc";

/** Default for the Start (first) column: highest priority first. */
export const START_COLUMN_DEFAULT_SORT: ColumnSortMode = "priority_desc";

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
  { value: "priority_desc", label: "Priority: 5 → None" },
  { value: "priority_asc", label: "Priority: None → 5" },
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

export function defaultSortForColumn(isStart: boolean): ColumnSortMode {
  return isStart ? START_COLUMN_DEFAULT_SORT : DEFAULT_COLUMN_SORT;
}

export function getColumnSortMode(
  map: ColumnSortMap,
  columnId: string,
  options?: { isStartColumn?: boolean }
): ColumnSortMode {
  // Start column is always Priority: 5 → None for every user (no localStorage override).
  if (options?.isStartColumn) return START_COLUMN_DEFAULT_SORT;
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

/** Rank for priority sort: null/unset → 0; score 1–5 unchanged. */
function priorityRank(specs: unknown): number {
  return priorityScoreFromSpecs(
    specs && typeof specs === "object"
      ? (specs as { priority_score?: number | null })
      : null
  ) ?? 0;
}

/**
 * Sort orders for display in a board column.
 * - manual: position ascending
 * - due_*: null due dates sort to the top
 * - priority_desc: 5 → 1 → None
 * - priority_asc: None → 1 → 5
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
    specs?: { priority_score?: unknown } | null;
    queue_rank?: number | null;
  },
>(orders: T[], mode: ColumnSortMode): T[] {
  const list = [...orders];

  // Start / In Progress carry a designer queue number — always show cards in
  // that ascending order (1, 2, 3 …). Ranked cards first; unranked fall to the
  // bottom by position. Only these columns set queue_rank, so others are
  // unaffected and the chosen sort mode still applies there.
  if (orders.some((o) => typeof o.queue_rank === "number")) {
    return list.sort((a, b) => {
      const ra = typeof a.queue_rank === "number" ? a.queue_rank : Number.POSITIVE_INFINITY;
      const rb = typeof b.queue_rank === "number" ? b.queue_rank : Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra - rb;
      return a.position - b.position;
    });
  }

  if (mode === "manual") {
    return list.sort((a, b) => a.position - b.position);
  }

  if (mode === "priority_desc" || mode === "priority_asc") {
    const dir = mode === "priority_asc" ? 1 : -1;
    return list.sort((a, b) => {
      const pa = priorityRank(a.specs);
      const pb = priorityRank(b.specs);
      if (pa !== pb) return (pa - pb) * dir;
      return a.position - b.position;
    });
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
