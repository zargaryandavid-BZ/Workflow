import {
  customerContactFromOrder,
  customerNameFromOrder,
} from "@/lib/notification-messages";
import {
  MANUAL_WEBHOOK_SOURCE_FILTER,
  OTHER_WEBHOOK_SOURCE_FILTER,
  UNASSIGNED_OWNER_FILTER,
} from "@/lib/constants";
import type { CustomField, OrderWithRelations } from "@/lib/types";

export interface BoardOrderFilters {
  q: string;
  personFilter: string;
  ownerFilter: string;
  /**
   * Webhook source key, or {@link MANUAL_WEBHOOK_SOURCE_FILTER} /
   * {@link OTHER_WEBHOOK_SOURCE_FILTER}. Empty = all.
   */
  webhookSourceFilter?: string;
  /**
   * Configured Integrations source keys (lowercase). Used when filtering
   * {@link OTHER_WEBHOOK_SOURCE_FILTER}.
   */
  knownWebhookSourceKeys?: readonly string[];
  /** When true, only cards with a past due date (not in Done columns). */
  overdueOnly?: boolean;
  /** When true, only cards due on today's business calendar date (not in Done). */
  dueTodayOnly?: boolean;
  /** Column ids with kind `done` — excluded when overdue/due-today filters are on. */
  doneColumnIds?: ReadonlySet<string>;
  /**
   * Active pipeline columns (Start → Ready to Ship). When set with overdue /
   * due-today filters, only these columns are included — same scope as Board health.
   */
  activePipelineColumnIds?: ReadonlySet<string>;
}

/**
 * True when the query looks like an order number (e.g. `213`, `0213-1`),
 * not a name/email/phone search. Short digit strings must not match phone
 * area codes (e.g. `213` → `+1213…`).
 */
export function isOrderNumberQuery(q: string): boolean {
  return /^0*\d{1,8}(-\d+)?$/i.test(q.trim());
}

/** Local calendar date as YYYY-MM-DD (machine / browser timezone). */
export function localDateString(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Shop calendar timezone for due dates / board health (server-safe). */
export const BUSINESS_TIMEZONE = "America/Los_Angeles";

/**
 * Business calendar date as YYYY-MM-DD in {@link BUSINESS_TIMEZONE}.
 * Use on the server so Late / Due today match LA, not UTC.
 */
export function businessDateString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** True when due date is before today's business calendar date (same as Board health Late). */
export function isOrderOverdue(
  dueDate: string | null | undefined,
  today: string = businessDateString()
): boolean {
  if (!dueDate) return false;
  return dueDate.slice(0, 10) < today;
}

/** True when due_date is exactly today's business calendar date (YYYY-MM-DD). */
export function isOrderDueToday(
  dueDate: string | null | undefined,
  today: string = businessDateString()
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
  // Normalize: strip leading # so "#213" and "213" both work as order number searches
  const q = filters.q.trim().replace(/^#/, "").toLowerCase();
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
      // Include all custom field values so searches like "shirt" or "rush" match
      // product type, notes, or any other custom field.
      const allFieldStrings = Object.values(fieldValues)
        .map((v) => {
          if (v === null || v === undefined) return "";
          if (typeof v === "string") return v;
          if (typeof v === "number" || typeof v === "boolean") return String(v);
          if (Array.isArray(v)) return v.join(" ");
          return "";
        })
        .filter(Boolean);

      const searchable = [
        order.title,
        customerName,
        email ?? "",
        phone ?? "",
        order.description ?? "",
        ...allFieldStrings,
      ]
        .join(" ")
        .toLowerCase();
      const terms = q.split(/\s+/).filter(Boolean);
      if (!terms.every((term) => searchable.includes(term))) return false;
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
  if (filters.webhookSourceFilter) {
    const raw = order.webhook_source;
    const key =
      raw == null ? null : String(raw).trim().toLowerCase();
    if (filters.webhookSourceFilter === MANUAL_WEBHOOK_SOURCE_FILTER) {
      if (key != null) return false;
    } else if (filters.webhookSourceFilter === OTHER_WEBHOOK_SOURCE_FILTER) {
      if (key == null) return false;
      const known = new Set(
        (filters.knownWebhookSourceKeys ?? []).map((k) => k.toLowerCase())
      );
      if (key !== "" && known.has(key)) return false;
    } else if (key !== filters.webhookSourceFilter.toLowerCase()) {
      return false;
    }
  }
  if (filters.overdueOnly) {
    if (!isOrderOverdue(order.due_date)) return false;
    if (filters.doneColumnIds?.has(order.column_id)) return false;
    if (
      filters.activePipelineColumnIds &&
      !filters.activePipelineColumnIds.has(order.column_id)
    ) {
      return false;
    }
  }
  if (filters.dueTodayOnly) {
    if (!isOrderDueToday(order.due_date)) return false;
    if (filters.doneColumnIds?.has(order.column_id)) return false;
    if (
      filters.activePipelineColumnIds &&
      !filters.activePipelineColumnIds.has(order.column_id)
    ) {
      return false;
    }
  }
  return true;
}
