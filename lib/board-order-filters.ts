import {
  customerContactFromOrder,
  customerNameFromOrder,
} from "@/lib/notification-messages";
import type { CustomField, OrderWithRelations } from "@/lib/types";

export interface BoardOrderFilters {
  q: string;
  personFilter: string;
  ownerFilter: string;
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
  return true;
}
