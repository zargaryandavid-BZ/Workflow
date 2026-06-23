import type { VisibilityMode } from "@/lib/types";

export interface VisibilityConfig {
  mode: VisibilityMode;
  roles: string[];
  userIds: string[];
}

/**
 * Returns true when a user should see / receive something restricted by a
 * RoleOrIndividualPicker value.
 *
 * mode: 'all'         → everyone qualifies
 * mode: 'roles'       → user's role must be in the roles list
 * mode: 'individuals' → user's ID must be in the userIds list
 */
export function userPassesVisibility(
  userId: string,
  userRole: string,
  visibility: VisibilityConfig
): boolean {
  if (visibility.mode === "all") return true;
  if (visibility.mode === "roles") return visibility.roles.includes(userRole);
  if (visibility.mode === "individuals") return visibility.userIds.includes(userId);
  return true;
}

/** Normalise a visibility_mode value coming from DB or client. */
export function normalizeVisibilityMode(value: unknown): VisibilityMode {
  if (value === "roles" || value === "individuals") return value;
  return "all";
}
