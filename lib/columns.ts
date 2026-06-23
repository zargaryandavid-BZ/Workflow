import { BOARD_ROLES } from "./constants";
import { userPassesVisibility } from "./check-visibility";
import type { BoardColumn, Role } from "./types";

/**
 * Normalizes a drop-role payload coming from the client into a value safe to
 * store in `board_columns.drop_in_roles` / `drop_out_roles`.
 *
 *   null / not an array         => null (unrestricted: any member can move)
 *   array of valid board roles  => deduped array (admins are always allowed)
 *
 * Admin is never stored in the array since admins bypass all drop checks.
 */
export function sanitizeDropRoles(value: unknown): Role[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  const allowed = new Set<string>(BOARD_ROLES);
  const roles = value.filter(
    (v): v is Role => typeof v === "string" && allowed.has(v)
  );
  return Array.from(new Set(roles));
}

/** Parse drop roles from Postgres / API (array or null). */
export function parseDropRoles(value: unknown): Role[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) return sanitizeDropRoles(value);
  return null;
}

/**
 * Treat an explicit list of every board role the same as unrestricted (null).
 * Covers legacy rows that stored all roles instead of null.
 */
export function effectiveDropRoles(roles: Role[] | null | undefined): Role[] | null {
  if (roles == null) return null;
  if (roles.length === 0) return [];
  if (BOARD_ROLES.every((role) => roles.includes(role))) return null;
  return roles;
}

/**
 * Sanitize visible_to_roles from the client.
 * Empty array → store as '{}' (visible to all).
 * Populated → only valid board roles are kept.
 */
export function sanitizeVisibleToRoles(value: unknown): Role[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(BOARD_ROLES);
  const roles = value.filter(
    (v): v is Role => typeof v === "string" && allowed.has(v)
  );
  return Array.from(new Set(roles));
}

/**
 * Sanitize visible_to_users from the client.
 * Accepts an array of UUID strings; rejects anything else.
 */
export function sanitizeVisibleToUsers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return Array.from(
    new Set(
      value.filter((v): v is string => typeof v === "string" && uuidRe.test(v))
    )
  );
}

/**
 * Returns true when a user should see the column.
 *
 * Priority:
 *  1. Admins always see everything.
 *  2. If the column has the new visibility_mode set, use userPassesVisibility.
 *  3. Fall back to legacy visible_to_roles / visible_to_users (OR logic).
 */
export function isColumnVisibleToUser(
  column: Pick<
    BoardColumn,
    "visible_to_roles" | "visible_to_users" | "visibility_mode" | "visibility_roles" | "visibility_users_v2"
  >,
  role: Role,
  userId: string
): boolean {
  if (role === "admin") return true;

  const mode = column.visibility_mode ?? "all";

  // Use new unified columns when they carry meaningful data.
  if (
    mode !== "all" ||
    (column.visibility_roles?.length ?? 0) > 0 ||
    (column.visibility_users_v2?.length ?? 0) > 0
  ) {
    return userPassesVisibility(userId, role, {
      mode,
      roles: column.visibility_roles ?? [],
      userIds: column.visibility_users_v2 ?? [],
    });
  }

  // Legacy fallback: empty arrays = visible to all.
  const roles = column.visible_to_roles ?? [];
  const users = column.visible_to_users ?? [];
  if (roles.length === 0 && users.length === 0) return true;
  return roles.includes(role) || users.includes(userId);
}

/** @deprecated Use isColumnVisibleToUser */
export function isColumnVisibleToRole(
  column: Pick<BoardColumn, "visible_to_roles" | "visible_to_users" | "visibility_mode" | "visibility_roles" | "visibility_users_v2">,
  role: Role
): boolean {
  return isColumnVisibleToUser(column, role, "");
}
