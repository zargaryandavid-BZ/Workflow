import { stageKey } from "./stage-groups";

/** Board columns that feed `/queue/prepress` (`Prepress`, `Pre-press`, …). */
export function isPrepressColumnName(
  name: string | null | undefined
): boolean {
  if (!name) return false;
  const key = stageKey(name);
  return key.includes("prepress") || key.includes("pre press");
}

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export interface PrepressQueueCardInput {
  id: string;
  /** specs.prepress_queue_pos, or null when never ranked. */
  queuePos: number | null | undefined;
  priority: string | null | undefined;
  dueDate: string | null | undefined;
}

/** Same order as GET /api/prepress/queue: saved pos, then priority, then due. */
export function rankPrepressQueue(
  cards: PrepressQueueCardInput[]
): Record<string, number> {
  const list = [...cards];
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
  const out: Record<string, number> = {};
  list.forEach((c, i) => {
    out[c.id] = i + 1;
  });
  return out;
}
