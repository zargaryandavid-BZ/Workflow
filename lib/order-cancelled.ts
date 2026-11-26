/**
 * Cancelled-order helpers (pure — safe for the board UI and node:test).
 * Hayk 2026-11-26: cancelled orders must not vanish from the board.
 */

/** Stamped on cards of an order cancelled at the source; blocks re-creating it. */
export const CRM_CANCELLED_AT_SPEC = "crm_cancelled_at";

/**
 * Where a cancelled order's cards go: the tenant's Canceled / Cancelled column
 * if it has one, otherwise "Finished: No Review Request" (Hayk 2026-11-26:
 * cancelled orders must not disappear — park them in Finished, no review, with
 * a CANCELLED badge; type "cancelled" in board search to list them).
 */
export function pickCanceledColumn(
  cols: { id: string; name: string | null }[],
): { id: string; name: string } | null {
  const hit =
    cols.find((c) => /\bcancell?ed\b/i.test(c.name ?? "")) ??
    cols.find((c) => /finished\W*no\s*review/i.test(c.name ?? ""));
  return hit ? { id: hit.id, name: hit.name ?? "Canceled" } : null;
}

/** True when the card belongs to an order cancelled at the source. */
export function isCancelledOrderSpecs(specs: unknown): boolean {
  const v = (specs as Record<string, unknown> | null)?.[CRM_CANCELLED_AT_SPEC];
  return typeof v === "string" && v.trim().length > 0;
}

/** Board search words that list cancelled cards. */
export function isCancelledSearchTerm(term: string): boolean {
  return /^cancell?ed$|^cancel$/i.test(term.trim());
}

