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

/** Always CC this teammate (first name) when a job goes on Hold. */
export const HOLD_WATCH_FIRST_NAME = "Rafayel";

export function isHoldWatchTeammateName(
  fullName: string | null | undefined
): boolean {
  const n = (fullName ?? "").trim();
  if (!n) return false;
  return new RegExp(`\\b${HOLD_WATCH_FIRST_NAME}\\b`, "i").test(n);
}

/** Owner plus named watchers, de-duplicated. Skips the person who moved the card. */
export function holdNotificationRecipientIds(
  ownerId: string | null | undefined,
  watcherUserIds: readonly string[],
  actorId?: string | null
): string[] {
  const ids = new Set<string>();
  const owner = ownerId?.trim();
  if (owner) ids.add(owner);
  for (const id of watcherUserIds) {
    const t = id.trim();
    if (t) ids.add(t);
  }
  const actor = actorId?.trim();
  if (actor) ids.delete(actor);
  return [...ids];
}
