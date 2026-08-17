import type { OrderExportData } from "@/lib/button-automation-order-data";
import { formatFieldDisplayValue } from "@/lib/order-form";

/** Stored in `webhook_body_template` when "Send full order card JSON" is enabled. */
export const FULL_ORDER_WEBHOOK_SENTINEL = "__FULL_ORDER_CARD__";

export function isFullOrderWebhookTemplate(
  template: string | null | undefined
): boolean {
  return (template ?? "").trim() === FULL_ORDER_WEBHOOK_SENTINEL;
}

function asString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value) || typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
}

function emptyable(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  return asString(value);
}

/**
 * Build a POST body with every order-card field the receiving system needs.
 * Missing values are empty string / null / [] so downstream software can always
 * read the same shape.
 */
export function buildFullOrderWebhookPayload(
  data: OrderExportData,
  extra: {
    event: "order_entered_column" | "order_created" | "order_webhook_test";
    columnId: string;
    tenantId: string;
    movedAt: string;
  }
): Record<string, unknown> {
  const order = data.order;
  const specs =
    order.specs && typeof order.specs === "object" && !Array.isArray(order.specs)
      ? (order.specs as Record<string, unknown>)
      : {};

  const customFields: Record<string, string> = {};
  for (const field of data.customFields) {
    const raw = data.fieldValues[field.id];
    if (raw == null || raw === "") {
      customFields[field.name] = "";
    } else {
      customFields[field.name] = formatFieldDisplayValue(raw);
    }
  }

  const specsOut: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(specs)) {
    specsOut[key] = emptyable(value) as string | number | boolean | null;
  }

  return {
    event: extra.event,
    moved_at: extra.movedAt || "",
    tenant: {
      id: extra.tenantId || "",
      name: data.tenantName || "",
    },
    column: {
      id: extra.columnId || order.column_id || "",
      name: data.columnName || "",
    },
    order: {
      id: order.id || "",
      title: order.title || "",
      order_number: data.orderNumber || "",
      order_number_display: data.orderNumberDisplay || "",
      description: order.description || "",
      internal_note: order.internal_note || "",
      priority: order.priority || "",
      priority_label: data.priority || "",
      due_date: order.due_date || "",
      due_date_formatted: data.dueDateFormatted === "—" ? "" : data.dueDateFormatted || "",
      production_date_formatted: data.productionDateFormatted || "",
      application_enabled: Boolean(data.applicationEnabled),
      column_id: order.column_id || "",
      customer_id: order.customer_id || "",
      tag_id: order.tag_id || "",
      tag_name: data.tagName || "",
      webhook_source: order.webhook_source || "",
      created_by: order.created_by || "",
      created_at: order.created_at || "",
      updated_at: order.updated_at || "",
      last_moved_at: order.last_moved_at || "",
      group_size: data.groupSize,
      total_qty: data.totalQty,
      specs: specsOut,
    },
    customer: {
      name: data.customerName === "—" ? "" : data.customerName || "",
      email: data.customerEmail || "",
      phone: data.customerPhone || "",
      contact: data.customerContact || "",
    },
    product: data.product || "",
    die: data.die || "",
    artwork_link: data.artworkLink || "",
    design_task: data.designTask || "",
    owner: {
      name: data.ownerName || "",
      email: data.ownerEmail || "",
    },
    designer: {
      name: data.designerName || "",
      email: data.designerEmail || "",
    },
    assigned_to: {
      name: data.assignedToName === "—" ? "" : data.assignedToName || "",
      email: data.assignedToEmail || "",
    },
    custom_fields: customFields,
    spec_rows: (data.specRows ?? []).map((row) => ({
      label: row.label || "",
      value: row.value || "",
    })),
    skus: (data.skuRows ?? []).map((row) => ({
      index: row.index,
      name: row.name || "",
      qty: row.qty,
      image_links: row.imageLinks ?? [],
    })),
  };
}

export function buildFullOrderWebhookTestPayload(): Record<string, unknown> {
  return {
    event: "order_webhook_test",
    moved_at: new Date().toISOString(),
    tenant: { id: "test-tenant", name: "Test Tenant" },
    column: { id: "test-column", name: "Test Column" },
    order: {
      id: "00000000-0000-0000-0000-000000000001",
      title: "ORD-TEST-001",
      order_number: "ORD-TEST-001",
      order_number_display: "ORD-TEST-001",
      description: "",
      internal_note: "",
      priority: "normal",
      priority_label: "Normal",
      due_date: "2026-12-31",
      due_date_formatted: "Dec 31, 2026",
      production_date_formatted: "",
      application_enabled: false,
      column_id: "test-column",
      customer_id: "",
      tag_id: "",
      tag_name: "",
      webhook_source: "",
      created_by: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_moved_at: new Date().toISOString(),
      group_size: null,
      total_qty: null,
      specs: {},
    },
    customer: {
      name: "Test Customer",
      email: "test@example.com",
      phone: "+18185551234",
      contact: "test@example.com",
    },
    product: "Test Product",
    die: "",
    artwork_link: "",
    design_task: "",
    owner: { name: "", email: "" },
    designer: { name: "", email: "" },
    assigned_to: { name: "Staff Member", email: "" },
    custom_fields: {},
    spec_rows: [],
    skus: [],
  };
}
