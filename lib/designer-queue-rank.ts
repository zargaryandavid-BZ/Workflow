/**
 * Pure ranking for the designer queue. Each designer's Start + In Progress
 * cards are ordered by: saved queue position first (when set), then priority,
 * then due date, then a stable id tiebreak — and numbered 1..N. Computed at
 * fetch time so the on-card #N badge works with zero stored data.
 */

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export interface QueueCardInput {
  id: string;
  designerId: string;
  /** specs.designer_queue_pos, or null/undefined when never ranked. */
  queuePos: number | null | undefined;
  priority: string | null | undefined;
  dueDate: string | null | undefined;
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
    list.sort((a, b) => {
      const ap = a.queuePos == null ? Number.POSITIVE_INFINITY : a.queuePos;
      const bp = b.queuePos == null ? Number.POSITIVE_INFINITY : b.queuePos;
      if (ap !== bp) return ap - bp;
      const pr =
        (PRIORITY_RANK[a.priority ?? "normal"] ?? 2) -
        (PRIORITY_RANK[b.priority ?? "normal"] ?? 2);
      if (pr !== 0) return pr;
      const ad = a.dueDate ?? "9999";
      const bd = b.dueDate ?? "9999";
      if (ad !== bd) return ad.localeCompare(bd);
      return a.id.localeCompare(b.id);
    });
    list.forEach((c, i) => {
      out[c.id] = i + 1;
    });
  }
  return out;
}
