import type { OrderSpecs } from "@/lib/types";

/** Valid board priority scores (1–5). */
export const PRIORITY_SCORES = [1, 2, 3, 4, 5] as const;
export type PriorityScore = (typeof PRIORITY_SCORES)[number];

export type PrioritySource = "customer" | "manual";

/** Background + text classes for the circular priority badge on cards. */
export const PRIORITY_SCORE_BADGE_STYLES: Record<PriorityScore, string> = {
  1: "bg-sky-500 text-white",
  2: "bg-emerald-500 text-white",
  3: "bg-amber-500 text-white",
  4: "bg-orange-500 text-white",
  5: "bg-red-500 text-white",
};

/** Parse a valid 1–5 priority score from any raw value, or null. */
export function parsePriorityScore(raw: unknown): PriorityScore | null {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 5) {
    return raw as PriorityScore;
  }
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    const n = Number(raw.trim());
    if (n >= 1 && n <= 5) return n as PriorityScore;
  }
  return null;
}

/** Read a valid 1–5 priority score from order specs, or null if unset. */
export function priorityScoreFromSpecs(
  specs: OrderSpecs | null | undefined
): PriorityScore | null {
  return parsePriorityScore(specs?.priority_score);
}

export function prioritySourceFromSpecs(
  specs: OrderSpecs | null | undefined
): PrioritySource | null {
  const raw = specs?.priority_source;
  if (raw === "customer" || raw === "manual") return raw;
  return null;
}

/**
 * Whether this order should receive an updated company default priority.
 * Manual card overrides are left alone; unset / customer-sourced scores sync.
 */
export function shouldSyncCustomerPriority(
  specs: OrderSpecs | null | undefined
): boolean {
  const score = priorityScoreFromSpecs(specs);
  const source = prioritySourceFromSpecs(specs);
  if (source === "manual") return false;
  if (source === "customer") return true;
  // Legacy / unset: only fill when there is no score yet.
  return score == null;
}

/** Specs patch when applying company default (or clearing it). */
export function customerPrioritySpecsPatch(
  existingSpecs: Record<string, unknown> | null | undefined,
  score: PriorityScore | null
): Record<string, unknown> {
  const next = { ...(existingSpecs ?? {}) };
  if (score == null) {
    delete next.priority_score;
    delete next.priority_source;
  } else {
    next.priority_score = score;
    next.priority_source = "customer";
  }
  return next;
}

/** Specs patch when staff sets priority on a card. */
export function manualPrioritySpecsPatch(
  existingSpecs: Record<string, unknown> | null | undefined,
  score: PriorityScore | null
): Record<string, unknown> {
  const next = { ...(existingSpecs ?? {}) };
  if (score == null) {
    delete next.priority_score;
    delete next.priority_source;
  } else {
    next.priority_score = score;
    next.priority_source = "manual";
  }
  return next;
}
