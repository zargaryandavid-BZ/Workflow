/**
 * Whether a column is a "Hold" stage — the one place we require a reason when a
 * card lands there, so the board records WHY a job is paused. Matched by name
 * ("Hold", "On Hold", "… Hold") so it works regardless of column id.
 */
export function isHoldColumn(col: {
  name?: string | null;
} | null | undefined): boolean {
  const name = (col?.name ?? "").trim().toLowerCase();
  if (!name) return false;
  return name === "hold" || name === "on hold" || /\bhold\b/.test(name);
}
