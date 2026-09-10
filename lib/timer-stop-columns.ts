import { stageKey } from "./stage-groups.ts";

/**
 * Timers only run while a card is in the Start column.
 * Every other column move stops any open timer immediately.
 *
 * "Start" is matched loosely: key === "start" OR key starts with "start "
 * so both "Start (Create Order)" and "START (Order Created)" are accepted.
 */
export function columnStopsWorkTimer(col: {
  kind?: string | null;
  name?: string | null;
}): boolean {
  const key = stageKey(col.name ?? "");
  // Allow the timer to keep running only in the Start column.
  if (key === "start" || key.startsWith("start ")) return false;
  // Every other column (In Progress, Missing Info, Hold, Approval, Done, etc.)
  // stops the timer.
  return true;
}
