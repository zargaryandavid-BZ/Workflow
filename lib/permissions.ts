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

/** Die Order page (admin, account manager, pre-production). */
export function canViewDieOrder(role: Role): boolean {
  return (
    role === "admin" ||
    role === "account_manager" ||
    role === "preprod_owner"
  );
}

/** Manual board create (no webhook) — shown as the "Manual" source label. */
export function isManualCreatedOrder(order: {
  webhook_source?: string | null;
}): boolean {
  const src = order.webhook_source;
  return src == null || String(src).trim() === "";
}

/**
 * Who may edit order tickets (Manual + CRM): Admin, Sales (Account Manager),
 * Pre-prod, Designer. CRM order numbers (title) stay locked — see canEditOrderTitle.
 */
export function canEditManualOrders(role: Role): boolean {
  return (
    role === "admin" ||
    role === "account_manager" ||
    role === "preprod_owner" ||
    role === "designer"
  );
}

/** Board card: assign designer via right-click (same roles as order edit). */
export function canAssignDesignerOnBoard(role: Role): boolean {
  return canEditManualOrders(role);
}

/** Whether `role` may change order details (save form / PATCH). */
export function canEditOrderDetails(
  role: Role,
  _order?: { webhook_source?: string | null }
): boolean {
  return canEditManualOrders(role);
}

/** Order number/title: editable only on Manual tickets (not CRM / webhook). */
export function canEditOrderTitle(
  role: Role,
  order: { webhook_source?: string | null }
): boolean {
  return canEditOrderDetails(role, order) && isManualCreatedOrder(order);
}

/**
 * Due date may be changed on Manual and CRM/webhook cards (same as board
 * right-click) even when the viewer cannot edit the full form.
 */
export function canEditOrderDueDate(mode: "edit" | "view" = "edit"): boolean {
  return mode !== "view";
}

/**
 * Assigned designer may be changed even when the viewer cannot edit the full
 * form (same rule as {@link canEditOrderDueDate}).
 */
export function canEditOrderDesigner(mode: "edit" | "view" = "edit"): boolean {
  return mode !== "view";
}

/** Spec keys board / ops may change without full Manual-order edit rights. */
const OPERATIONAL_SPEC_KEYS = new Set([
  "designer_id",
  "designer_name",
  "design_task",
  "priority_score",
  "priority_source",
  "due_date_mode",
  "due_processing_days",
  "due_anchor_at",
  "due_date_label",
  "due_date_status",
  "card_image",
]);

function jsonStable(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/**
 * True when a PATCH would change full form fields (title, customer, SKUs,
 * etc.). Board ops (designer, due date, tag, priority score) return false.
 */
export function orderPatchRequiresFormEdit(
  body: {
    title?: unknown;
    description?: unknown;
    internal_note?: unknown;
    priority?: unknown;
    ownerId?: unknown;
    customFieldValues?: unknown;
    specs?: Record<string, unknown>;
  },
  existingSpecs: Record<string, unknown>
): boolean {
  if (body.title !== undefined) return true;
  if (body.description !== undefined) return true;
  if (body.internal_note !== undefined) return true;
  if (body.priority !== undefined) return true;
  if (body.ownerId !== undefined) return true;
  if (body.customFieldValues !== undefined) return true;

  if (body.specs === undefined) return false;
  const next = body.specs;
  const keys = new Set([
    ...Object.keys(existingSpecs),
    ...Object.keys(next),
  ]);
  for (const key of keys) {
    if (OPERATIONAL_SPEC_KEYS.has(key)) continue;
    if (jsonStable(existingSpecs[key]) !== jsonStable(next[key])) {
      return true;
    }
  }
  return false;
}
