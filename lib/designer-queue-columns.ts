import { stageKey } from "@/lib/stage-groups";

/**
 * The designer "queue" is the work they pick from: the Start and In Progress
 * columns only. A card gets a per-designer rank number (#1, #2, …) only while
 * it lives in one of these; cards in Hold, production, shipped, etc. carry no
 * queue number. Matched by canonical stage name so it holds across tenants.
 */
export function isDesignerQueueColumnName(
  name: string | null | undefined
): boolean {
  if (!name) return false;
  const key = stageKey(name);
  return key === "start create order" || key === "start" || key === "in progress";
}
