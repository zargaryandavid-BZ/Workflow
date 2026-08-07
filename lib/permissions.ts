import type { BoardColumn, Role } from "./types";
import { effectiveDropRoles, parseDropRoles } from "./columns";

type DropColumn = Pick<
  BoardColumn,
  "id" | "drop_in_roles" | "drop_out_roles"
>;

function dropInRoles(column: DropColumn): Role[] | null {
  return effectiveDropRoles(parseDropRoles(column.drop_in_roles));
}

function dropOutRoles(column: DropColumn): Role[] | null {
  return effectiveDropRoles(parseDropRoles(column.drop_out_roles));
}

/** Whether `role` may move an order INTO `column`. */
export function canDropIn(role: Role, column: DropColumn): boolean {
  if (role === "admin" || role === "account_manager") return true;
  const roles = dropInRoles(column);
  if (roles == null) return true; // unrestricted
  return roles.includes(role); // [] => admins only
}

/** Whether `role` may move an order OUT OF `column`. */
export function canDropOut(role: Role, column: DropColumn): boolean {
  if (role === "admin" || role === "account_manager") return true;
  const roles = dropOutRoles(column);
  if (roles == null) return true; // unrestricted
  return roles.includes(role); // [] => admins only
}

/**
 * Whether `role` may pick up / drag cards in `column` (reorder within column
 * requires drop-in; leaving the column requires drop-out).
 */
export function canDragInColumn(role: Role, column: DropColumn): boolean {
  return canDropOut(role, column) || canDropIn(role, column);
}

/**
 * Whether `role` may move a card out of `column` to a different column.
 *
 * Normally requires ↑. If ↑ is narrower than ↓ but the role is explicitly on
 * the ↓ list (e.g. Arsen ↓ Designer, ↑ AM only), they may still leave — that
 * matches being able to pick up the card. ↓ All does not grant leave rights
 * when ↑ is restricted. ↑ Admins only (`[]`) always blocks non-admins.
 */
export function canLeaveColumn(role: Role, column: DropColumn): boolean {
  if (role === "admin" || role === "account_manager") return true;
  if (canDropOut(role, column)) return true;
  const out = dropOutRoles(column);
  if (out != null && out.length === 0) return false;
  const inn = dropInRoles(column);
  return inn != null && inn.includes(role);
}

/**
 * Whether `role` may move an order from `from` to `to`. Reordering within the
 * same column only requires drop-in rights on that column.
 */
export function canMove(role: Role, from: DropColumn, to: DropColumn): boolean {
  if (role === "admin" || role === "account_manager") return true;
  if (from.id === to.id) return canDropIn(role, to);
  return canLeaveColumn(role, from) && canDropIn(role, to);
}

/** Board card: assign designer via right-click (admin + account manager). */
export function canAssignDesignerOnBoard(role: Role): boolean {
  return role === "admin" || role === "account_manager";
}

/** Board / customers: set tag or priority score (admin + pre-prod). */
export function canSetBoardTagAndPriority(role: Role): boolean {
  return role === "admin" || role === "preprod_owner";
}

/** Board card: column action buttons in the right-click menu. */
export function canUseBoardActionButtons(role: Role): boolean {
  return role === "admin" || role === "account_manager";
}

/** Analytics dashboard (admin + account manager). */
export function canViewAnalytics(role: Role): boolean {
  return role === "admin" || role === "account_manager";
}
