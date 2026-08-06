import type { OrderSpecs } from "@/lib/types";

/** Valid board priority scores (1–5). */
export const PRIORITY_SCORES = [1, 2, 3, 4, 5] as const;
export type PriorityScore = (typeof PRIORITY_SCORES)[number];

/** Background + text classes for the circular priority badge on cards. */
export const PRIORITY_SCORE_BADGE_STYLES: Record<PriorityScore, string> = {
  1: "bg-sky-500 text-white",
  2: "bg-emerald-500 text-white",
  3: "bg-amber-500 text-white",
  4: "bg-orange-500 text-white",
  5: "bg-red-600 text-white",
};

/** Read a valid 1–5 priority score from order specs, or null if unset. */
export function priorityScoreFromSpecs(
  specs: OrderSpecs | null | undefined
): PriorityScore | null {
  const raw = specs?.priority_score;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 5) {
    return raw as PriorityScore;
  }
  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n >= 1 && n <= 5) return n as PriorityScore;
  }
  return null;
}
