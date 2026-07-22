import {
  customerContactFromOrder,
  customerNameFromOrder,
} from "@/lib/notification-messages";
import { UNASSIGNED_OWNER_FILTER } from "@/lib/constants";
import type { CustomField, OrderWithRelations } from "@/lib/types";

export interface BoardOrderFilters {
  q: string;
  personFilter: string;
  ownerFilter: string;
  /** When true, only cards with a past due date (not in Done columns). */
  overdueOnly?: boolean;
  /** When true, only cards due on today's local calendar date (not in Done). */
  dueTodayOnly?: boolean;
  /** Column ids with kind `done` — excluded when overdue/due-today filters are on. */
  doneColumnIds?: ReadonlySet<string>;
}

/**
 * True when the query looks like an order number (e.g. `213`, `0213-1`),
 * not a name/email/phone search. Short digit strings must not match phone
 * area codes (e.g. `213` → `+1213…`).
 */
export function isOrderNumberQuery(q: string): boolean {
  return /^0*\d{1,8}(-\d+)?$/i.test(q.trim());
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

/** True when due_date is exactly today's local calendar date (YYYY-MM-DD). */
export function isOrderDueToday(
  dueDate: string | null | undefined,
  today: string = localDateString()
): boolean {
  if (!dueDate) return false;
  return dueDate.slice(0, 10) === today;
}

export function orderMatchesBoardFilters(
  order: OrderWithRelations,
  fieldValues: Record<string, unknown>,
  customFields: CustomField[],
  filters: BoardOrderFilters
): boolean {
  const q = filters.q.trim().toLowerCase();
  if (q) {
    if (isOrderNumberQuery(q)) {
      if (!order.title.toLowerCase().includes(q)) return false;
    } else {
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
  }
  if (filters.personFilter) {
    const designerId = (order.specs?.designer_id as string | undefined) ?? "";
    if (designerId !== filters.personFilter) return false;
  }
  if (filters.ownerFilter) {
    if (filters.ownerFilter === UNASSIGNED_OWNER_FILTER) {
      if (order.created_by) return false;
    } else if (order.created_by !== filters.ownerFilter) {
      return false;
    }
  }
  if (filters.overdueOnly) {
    if (!isOrderOverdue(order.due_date)) return false;
    if (filters.doneColumnIds?.has(order.column_id)) return false;
  }
  if (filters.dueTodayOnly) {
    if (!isOrderDueToday(order.due_date)) return false;
    if (filters.doneColumnIds?.has(order.column_id)) return false;
  }
  return true;
}
