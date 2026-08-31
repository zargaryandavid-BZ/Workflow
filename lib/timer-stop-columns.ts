import { stageKey } from "./stage-groups.ts";

/**
 * Columns where design work is waiting on the customer / sales — running
 * timers should stop (and not start) while the card sits here.
 */
export function columnStopsWorkTimer(col: {
  kind?: string | null;
  name?: string | null;
}): boolean {
  if (col.kind === "approval") return true;
  const key = stageKey(col.name ?? "");
  if (!key) return false;
  if (key === "hold" || key === "on hold") return true;
  if (key.includes("missing info") || key.includes("missing information")) {
    return true;
  }
  if (key === "customer replied" || key.endsWith(" customer replied")) {
    return true;
  }
  if (key.includes("waiting approval")) return true;
  return false;
}
