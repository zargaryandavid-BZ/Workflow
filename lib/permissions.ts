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
 * Whether `role` may move an order from `from` to `to`. Reordering within the
 * same column only requires drop-in rights on that column.
 */
export function canMove(role: Role, from: DropColumn, to: DropColumn): boolean {
  if (role === "admin" || role === "account_manager") return true;
  if (from.id === to.id) return canDropIn(role, to);
  return canDropOut(role, from) && canDropIn(role, to);
}
