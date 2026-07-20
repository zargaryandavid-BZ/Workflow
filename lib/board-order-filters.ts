import {
  customerContactFromOrder,
  customerNameFromOrder,
} from "@/lib/notification-messages";
import type { CustomField, OrderWithRelations } from "@/lib/types";

export interface BoardOrderFilters {
  q: string;
  personFilter: string;
  ownerFilter: string;
  /** When true, only cards with a past due date (not in Done columns). */
  overdueOnly?: boolean;
  /** Column ids with kind `done` — excluded when overdueOnly is on. */
  doneColumnIds?: ReadonlySet<string>;
}

/** Local calendar date as YYYY-MM-DD. */
export function localDateString(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** True when due date is before the end of today (same rule as analytics). */
export function isOrderOverdue(
  dueDate: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!dueDate) return false;
  return new Date(`${dueDate}T23:59:59`).getTime() < nowMs;
}

export function orderMatchesBoardFilters(
  order: OrderWithRelations,
  fieldValues: Record<string, unknown>,
  customFields: CustomField[],
  filters: BoardOrderFilters
): boolean {
  const q = filters.q.trim().toLowerCase();
  if (q) {
    const customerName = customerNameFromOrder(
      order,
      fieldValues,
      customFields
    ).toLowerCase();
    const { email, phone } = customerContactFromOrder(
      order,
      fieldValues,
      customFields
    );
    const searchable = [order.title, customerName, email ?? "", phone ?? ""]
      .join(" ")
      .toLowerCase();
    if (!searchable.includes(q)) return false;
  }
  if (filters.personFilter) {
    const designerId = (order.specs?.designer_id as string | undefined) ?? "";
    if (designerId !== filters.personFilter) return false;
  }
  if (filters.ownerFilter && order.created_by !== filters.ownerFilter) {
    return false;
  }
  if (filters.overdueOnly) {
    if (!isOrderOverdue(order.due_date)) return false;
    if (filters.doneColumnIds?.has(order.column_id)) return false;
  }
  return true;
}
