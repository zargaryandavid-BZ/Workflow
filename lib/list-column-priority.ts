/**
 * List view → "Column" priority mode (pick ONE board column, set the order of
 * its cards). Pure helpers only — no fetches — so the reorder / renumber rules
 * are unit-tested and the UI just wires them up.
 *
 * Which number a column reorders is decided by what the Kanban board itself
 * already sorts that column by, so a reorder in the list shows up on the
 * board immediately:
 *   • Start (Create Order) → the per-designer queue (`specs.designer_queue_pos`,
 *     the dark #N badge). Same store as /queue and the #N badge editor.
 *   • Prepress            → the shared prepress queue (`specs.prepress_queue_pos`).
 *   • In Progress         → also per-designer queue, but it shares numbers with
 *     Start, so it is shown in queue order read-only (reorder from Start).
 *   • Any other column    → the column's manual order (`orders.position`, the
 *     Kanban "Manual order" sort).
 */

import { stageKey } from "./stage-groups.ts";

export type ColumnPriorityMode =
  | "designer_queue"
  | "designer_queue_readonly"
  | "prepress_queue"
  | "manual_position";

export function columnPriorityMode(
  columnName: string | null | undefined
): ColumnPriorityMode {
  const key = stageKey(columnName ?? "");
  if (key === "start create order" || key === "start") return "designer_queue";
  if (key === "in progress") return "designer_queue_readonly";
  if (key.includes("prepress") || key.includes("pre press")) {
    return "prepress_queue";
  }
  return "manual_position";
}

export interface PriorityRowInput {
  id: string;
  position: number;
  priority?: string | null;
  due_date?: string | null;
  specs?: Record<string, unknown> | null;
}

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function numOrNull(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function designerIdOf(order: PriorityRowInput): string {
  const d = order.specs?.designer_id;
  return typeof d === "string" ? d : "";
}

/** Rows are grouped per designer only for the designer queue (each has 1..N). */
export function priorityGroupKey(
  order: PriorityRowInput,
  mode: ColumnPriorityMode
): string {
  if (mode === "designer_queue" || mode === "designer_queue_readonly") {
    return designerIdOf(order);
  }
  return "all";
}

/**
 * Same order the board / queue pages use:
 *  - queues: saved queue pos (unset last) → priority → due → id
 *    (matches rankDesignerQueue / rankPrepressQueue / GET /api/designers/queue)
 *  - manual_position: `position` ascending (Kanban "Manual order").
 * Missing priority (e.g. website orders) sorts as "normal" and is never hidden.
 */
export function sortForColumnPriority<T extends PriorityRowInput>(
  orders: T[],
  mode: ColumnPriorityMode
): T[] {
  const list = [...orders];
  if (mode === "manual_position") {
    return list.sort(
      (a, b) => a.position - b.position || a.id.localeCompare(b.id)
    );
  }
  const posKey =
    mode === "prepress_queue" ? "prepress_queue_pos" : "designer_queue_pos";
  return list.sort((a, b) => {
    const ap = numOrNull(a.specs?.[posKey]) ?? Number.POSITIVE_INFINITY;
    const bp = numOrNull(b.specs?.[posKey]) ?? Number.POSITIVE_INFINITY;
    if (ap !== bp) return ap - bp;
    const pr =
      (PRIORITY_RANK[a.priority ?? "normal"] ?? 2) -
      (PRIORITY_RANK[b.priority ?? "normal"] ?? 2);
    if (pr !== 0) return pr;
    const ad = a.due_date ?? "9999";
    const bd = b.due_date ?? "9999";
    if (ad !== bd) return ad.localeCompare(bd);
    return a.id.localeCompare(b.id);
  });
}

/** Move `id` to 0-based `toIndex` (clamped). Returns a new array. */
export function moveId(ids: string[], id: string, toIndex: number): string[] {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const to = Math.max(0, Math.min(ids.length - 1, Math.floor(toIndex)));
  if (to === from) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Typed "#" number (1 = top) → move there. Invalid input → unchanged. */
export function moveIdToNumber(
  ids: string[],
  id: string,
  oneBased: number
): string[] {
  if (!Number.isFinite(oneBased) || oneBased < 1) return ids;
  return moveId(ids, id, Math.floor(oneBased) - 1);
}

/**
 * The list may show only part of a queue (owner / source / search filters, or
 * cards not loaded yet). Put the reordered visible cards back into the FULL
 * queue in the slots they already occupy, so hidden cards keep their places
 * and nobody else's number collides.
 *
 * Visible ids missing from the full list (moved away meanwhile) are dropped.
 */
export function mergeSubsetOrder(
  fullIds: string[],
  orderedSubset: string[]
): string[] {
  const fullSet = new Set(fullIds);
  const subset = orderedSubset.filter((id) => fullSet.has(id));
  const subsetSet = new Set(subset);
  let k = 0;
  return fullIds.map((id) => (subsetSet.has(id) ? subset[k++] : id));
}

/** Queue write payload: order id → 0-based position (what the APIs store). */
export function posByIdFromOrder(ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  ids.forEach((id, i) => {
    out[id] = i;
  });
  return out;
}

/**
 * Manual-order columns: the single new `position` for the moved card, placed
 * between its new neighbours (same rule as a Kanban same-column drag), so a
 * reorder is ONE write. `positions` maps every id in `ids` to its position.
 */
export function positionForMovedId(
  ids: string[],
  movedId: string,
  positions: Record<string, number>
): number | null {
  const i = ids.indexOf(movedId);
  if (i === -1) return null;
  const prev = i > 0 ? positions[ids[i - 1]] : undefined;
  const next = i < ids.length - 1 ? positions[ids[i + 1]] : undefined;
  if (prev === undefined && next === undefined) return positions[movedId] ?? 0;
  if (prev === undefined) return (next as number) - 1000;
  if (next === undefined) return prev + 1000;
  return (prev + next) / 2;
}

/**
 * Drag result: the dragged row takes the slot of the row it was dropped on
 * (dragging down lands after it, dragging up lands before it — dnd-kit
 * sortable semantics). Unknown ids / dropped on itself → unchanged.
 */
export function reorderAfterDrag(
  ids: string[],
  activeId: string,
  overId: string | null | undefined
): string[] {
  if (!overId || activeId === overId) return ids;
  const to = ids.indexOf(overId);
  if (to === -1 || !ids.includes(activeId)) return ids;
  return moveId(ids, activeId, to);
}

/** Priority picker choices for a group of `count` jobs: 1..count. */
export function priorityOptions(count: number): number[] {
  const n = Math.max(0, Math.floor(count));
  return Array.from({ length: n }, (_, i) => i + 1);
}
