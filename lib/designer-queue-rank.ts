/**
 * Pure ranking for the designer queue (Start + In Progress cards, per designer),
 * numbered 1..N. Computed at fetch time so the on-card #N badge needs no
 * stored data.
 *
 * Hayk 2026-11-26: the queue runs itself —
 *   1. RUSH first (rush flag / Rush tag, or urgent/high priority),
 *   2. then the card that has sat LONGEST in its current column
 *      (oldest last_moved_at, falling back to created_at),
 *   3. stable id tiebreak.
 * A manager's manual placement overrides it: a card dragged / set to #N
 * (`specs.designer_queue_manual === true`) is put back at that slot
 * (`designer_queue_pos`, 0-based) and the auto-ordered cards flow around it.
 * The stored `designer_queue_pos` of auto cards is only a snapshot and is
 * ignored for ordering.
 */

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export const DESIGNER_QUEUE_MANUAL_KEY = "designer_queue_manual";

export interface QueueCardInput {
  id: string;
  designerId: string;
  /** specs.designer_queue_pos, or null/undefined when never ranked. */
  queuePos: number | null | undefined;
  priority: string | null | undefined;
  dueDate: string | null | undefined;
  /** specs.designer_queue_manual — a manager placed this card by hand. */
  manual?: boolean | null;
  /** Rush flag / Rush tag on the order. */
  rush?: boolean | null;
  /** When the card entered its current column (last_moved_at ?? created_at). */
  enteredAt?: string | null;
}

function isRushCard(c: QueueCardInput): boolean {
  if (c.rush === true) return true;
  const p = c.priority ?? "normal";
  return p === "urgent" || p === "high";
}

function enteredMs(c: QueueCardInput): number {
  const t = c.enteredAt ? Date.parse(c.enteredAt) : NaN;
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/** Auto order: rush first, then longest in column, then id. */
export function compareAutoQueue(a: QueueCardInput, b: QueueCardInput): number {
  const ar = isRushCard(a) ? 0 : 1;
  const br = isRushCard(b) ? 0 : 1;
  if (ar !== br) return ar - br;
  // Among rush cards, urgent before high.
  const pr =
    (PRIORITY_RANK[a.priority ?? "normal"] ?? 2) -
    (PRIORITY_RANK[b.priority ?? "normal"] ?? 2);
  if (ar === 0 && pr !== 0) return pr;
  const at = enteredMs(a);
  const bt = enteredMs(b);
  if (at !== bt) return at - bt;
  return a.id.localeCompare(b.id);
}

/** One designer's list in display order (manual slots kept, auto around them). */
export function orderDesignerQueue<T extends QueueCardInput>(list: T[]): T[] {
  const manual = list
    .filter((c) => c.manual === true && c.queuePos != null && Number.isFinite(c.queuePos))
    .sort((a, b) => (a.queuePos as number) - (b.queuePos as number) || a.id.localeCompare(b.id));
  const manualIds = new Set(manual.map((c) => c.id));
  const out = list.filter((c) => !manualIds.has(c.id)).sort(compareAutoQueue);
  for (const c of manual) {
    const at = Math.max(0, Math.min(out.length, Math.floor(c.queuePos as number)));
    out.splice(at, 0, c);
  }
  return out;
}

export function rankDesignerQueue(
  cards: QueueCardInput[]
): Record<string, number> {
  const byDesigner = new Map<string, QueueCardInput[]>();
  for (const c of cards) {
    if (!c.designerId) continue;
    const list = byDesigner.get(c.designerId) ?? [];
    list.push(c);
    byDesigner.set(c.designerId, list);
  }

  const out: Record<string, number> = {};
  for (const list of byDesigner.values()) {
    orderDesignerQueue(list).forEach((c, i) => {
      out[c.id] = i + 1;
    });
  }
  return out;
}

/** Build a ranking input from an order row. */
export function queueInputFromRow(r: {
  id: string;
  priority?: string | null;
  due_date?: string | null;
  last_moved_at?: string | null;
  created_at?: string | null;
  specs?: unknown;
  tag?: { name?: string | null } | null;
}): QueueCardInput {
  const specs = (r.specs ?? {}) as Record<string, unknown>;
  const raw = specs.designer_queue_pos;
  const n = typeof raw === "number" ? raw : raw == null || raw === "" ? NaN : Number(raw);
  return {
    id: r.id,
    designerId: String(specs.designer_id ?? ""),
    queuePos: Number.isFinite(n) ? n : null,
    priority: r.priority ?? null,
    dueDate: r.due_date ?? null,
    manual: specs[DESIGNER_QUEUE_MANUAL_KEY] === true,
    rush: specs.rush === true || /rush/i.test(r.tag?.name ?? ""),
    enteredAt: r.last_moved_at ?? r.created_at ?? null,
  };
}
