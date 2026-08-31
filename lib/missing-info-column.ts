/**
 * Pure pick: the board's Missing Info column from a column list. Prefers an
 * `exception`-kind column whose name mentions "missing", then any column named
 * "missing", then any exception column. Returns null when none fit.
 *
 * Kept dependency-free so it can be unit-tested in isolation.
 */
export function pickMissingInfoColumn(
  cols: { id: string; name: string | null; kind: string | null }[]
): { id: string; name: string | null } | null {
  const named = cols.filter((c) => /missing/i.test(c.name ?? ""));
  const pick =
    named.find((c) => c.kind === "exception") ??
    named[0] ??
    cols.find((c) => c.kind === "exception") ??
    null;
  return pick ? { id: pick.id, name: pick.name } : null;
}
