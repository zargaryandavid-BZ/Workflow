import type { BoardColumn, Role } from "./types";

type DropColumn = Pick<
  BoardColumn,
  "id" | "drop_in_roles" | "drop_out_roles"
>;

/** Whether `role` may move an order INTO `column`. */
export function canDropIn(role: Role, column: DropColumn): boolean {
  if (role === "admin") return true;
  const roles = column.drop_in_roles;
  if (roles == null) return true; // unrestricted
  return roles.includes(role); // [] => admins only
}

/** Whether `role` may move an order OUT OF `column`. */
export function canDropOut(role: Role, column: DropColumn): boolean {
  if (role === "admin") return true;
  const roles = column.drop_out_roles;
  if (roles == null) return true; // unrestricted
  return roles.includes(role); // [] => admins only
}

/**
 * Whether `role` may move an order from `from` to `to`. Reordering within the
 * same column only requires drop-in rights on that column.
 */
export function canMove(role: Role, from: DropColumn, to: DropColumn): boolean {
  if (role === "admin") return true;
  if (from.id === to.id) return canDropIn(role, to);
  return canDropOut(role, from) && canDropIn(role, to);
}
