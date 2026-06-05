import { BOARD_ROLES } from "./constants";
import type { Role } from "./types";

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
