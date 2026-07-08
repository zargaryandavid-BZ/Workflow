import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  ARTWORK_FIELD_NAME,
  CUSTOMER_CONTACT_FIELD_NAME,
  CUSTOMER_NAME_FIELD_NAME,
  DESIGNER_FIELD_NAME,
} from "@/lib/constants";
import {
  findOrderFormField,
  orderFormFieldLabel,
  ORDER_FORM_PRINT_FIELD_NAMES,
} from "@/lib/order-form";
import { loadOrderWithRelations } from "@/lib/orders/load-with-relations";
import {
  attachSignedUrlsToSkuImages,
  listSkuImagesForOrder,
} from "@/lib/sku-images";
import { normalizeSkus, type SkuItem } from "@/lib/skus";
import {
  customerContactFromOrder,
  customerNameFromOrder,
  productFromOrder,
} from "@/lib/notification-messages";
import { formatDate } from "@/lib/utils";
import type {
  BoardColumn,
  CustomField,
  CustomFieldValue,
  OrderSkuImageWithUrl,
  OrderWithRelations,
} from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface OrderExportSkuRow {
  index: number;
  name: string;
  qty: number | null;
  imageLinks: string[];
}

export interface OrderExportSpecRow {
  label: string;
  value: string;
}

export interface OrderExportData {
  order: OrderWithRelations;
  columnName: string;
  tagName: string | null;
  fieldValues: Record<string, unknown>;
  customFields: CustomField[];
  skus: SkuItem[];
  skuRows: OrderExportSkuRow[];
  specRows: OrderExportSpecRow[];
  totalQty: number | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerContact: string;
  artworkLink: string;
  designTask: string;
  ownerName: string | null;
  ownerEmail: string | null;
  designerName: string | null;
  designerEmail: string | null;
  assignedToName: string;
  assignedToEmail: string | null;
  product: string;
  die: string;
  orderNumber: string;
  dueDateFormatted: string;
  priority: string;
  tenantName: string;
}

async function profileEmail(userId: string): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data.user) return null;
    return data.user.email ?? null;
  } catch {
    return null;
  }
}

async function profileName(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  return data?.full_name?.trim() || null;
}

function valuesByFieldId(values: CustomFieldValue[]): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const row of values) {
    map[row.custom_field_id] = row.value;
  }
  return map;
}

function buildSpecRows(
  customFields: CustomField[],
  fieldValues: Record<string, unknown>
): OrderExportSpecRow[] {
  const checkboxToYesNo = (raw: unknown): "Yes" | "No" => {
    if (typeof raw === "boolean") return raw ? "Yes" : "No";
    if (typeof raw === "number") return raw === 1 ? "Yes" : "No";
    if (typeof raw === "string") {
      const value = raw.trim().toLowerCase();
      if (["true", "yes", "1", "on", "checked"].includes(value)) return "Yes";
      if (
        [
          "false",
          "no",
          "0",
          "off",
          "unchecked",
          "",
          "\"",
          "null",
          "undefined",
        ].includes(value)
      ) {
        return "No";
      }
      // Unknown checkbox-like strings should not print as raw text.
      return "No";
    }
    return "No";
  };

  const byName = new Map(
    customFields.map((f) => [f.name.toLowerCase(), f])
  );
  const skip = new Set(
    [
      CUSTOMER_NAME_FIELD_NAME,
      CUSTOMER_CONTACT_FIELD_NAME,
      ARTWORK_FIELD_NAME,
      DESIGNER_FIELD_NAME,
      "designer",
    ].map((n) => n.toLowerCase())
  );

  const rows: OrderExportSpecRow[] = [];
  for (const name of ORDER_FORM_PRINT_FIELD_NAMES) {
    const field = byName.get(name.toLowerCase());
    if (!field) continue;
    const raw = fieldValues[field.id];
    if (field.field_type !== "checkbox" && (raw === null || raw === undefined || raw === "")) continue;
    rows.push({
      label: orderFormFieldLabel(field.name),
      value:
        field.field_type === "checkbox"
          ? checkboxToYesNo(raw)
          : typeof raw === "boolean"
            ? (raw ? "Yes" : "No")
            : String(raw),
    });
  }

  for (const field of customFields) {
    if (skip.has(field.name.toLowerCase())) continue;
    if (ORDER_FORM_PRINT_FIELD_NAMES.some(
      (n) => n.toLowerCase() === field.name.toLowerCase()
    )) {
      continue;
    }
    const raw = fieldValues[field.id];
    if (field.field_type !== "checkbox" && (raw === null || raw === undefined || raw === "")) continue;
    rows.push({
      label: orderFormFieldLabel(field.name),
      value:
        field.field_type === "checkbox"
          ? checkboxToYesNo(raw)
          : typeof raw === "boolean"
            ? (raw ? "Yes" : "No")
            : String(raw),
    });
  }

  return rows;
}

function buildSkuRows(
  skus: SkuItem[],
  imagesBySkuId: Record<string, OrderSkuImageWithUrl[]>
): OrderExportSkuRow[] {
  return skus.map((sku, index) => ({
    index: index + 1,
    name: sku.name.trim() || `SKU ${index + 1}`,
    qty: sku.qty,
    imageLinks: (imagesBySkuId[sku.id] ?? [])
      .map((img) => img.signed_url)
      .filter((url): url is string => Boolean(url)),
  }));
}

export async function loadOrderExportData(
  supabase: SupabaseClient,
  orderId: string,
  tenantId: string,
  tenantName: string
): Promise<OrderExportData | null> {
  const order = await loadOrderWithRelations(supabase, orderId, tenantId);
  if (!order) return null;

  const [
    { data: values },
    { data: fields },
    { data: column },
    skuImagesRaw,
  ] = await Promise.all([
    supabase.from("custom_field_values").select("*").eq("order_id", orderId),
    supabase
      .from("custom_fields")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true }),
    supabase
      .from("board_columns")
      .select("id, name")
      .eq("id", order.column_id)
      .maybeSingle(),
    listSkuImagesForOrder(supabase, orderId).catch(() => []),
  ]);

  const customFields = (fields ?? []) as CustomField[];
  const fieldValues = valuesByFieldId((values ?? []) as CustomFieldValue[]);
  const skuImages = await attachSignedUrlsToSkuImages(
    supabase,
    skuImagesRaw
  ).catch(() => [] as OrderSkuImageWithUrl[]);

  const imagesBySkuId: Record<string, OrderSkuImageWithUrl[]> = {};
  for (const img of skuImages) {
    (imagesBySkuId[img.sku_id] ??= []).push(img);
  }

  const skus = normalizeSkus(order.specs?.skus);
  const skuRows = buildSkuRows(skus, imagesBySkuId);
  const totalQty =
    skus.length > 0
      ? skus.reduce((sum, s) => sum + (s.qty ?? 0), 0)
      : null;

  const customerName = customerNameFromOrder(order, fieldValues, customFields);
  const contact = customerContactFromOrder(order, fieldValues, customFields);
  const customerContact =
    contact.email ??
    contact.phone ??
    order.customer?.email ??
    order.customer?.phone ??
    "";

  const artworkField = findOrderFormField(customFields, ARTWORK_FIELD_NAME);
  const artworkLink = artworkField
    ? String(fieldValues[artworkField.id] ?? "").trim()
    : "";

  const designerId =
    typeof order.specs?.designer_id === "string"
      ? order.specs.designer_id
      : null;
  const designerNameFromSpecs =
    typeof order.specs?.designer_name === "string"
      ? order.specs.designer_name.trim()
      : null;

  const [ownerProfileName, designerProfileName, ownerEmail, designerEmail] =
    await Promise.all([
      order.created_by ? profileName(supabase, order.created_by) : null,
      designerId ? profileName(supabase, designerId) : null,
      order.created_by ? profileEmail(order.created_by) : null,
      designerId ? profileEmail(designerId) : null,
    ]);

  const designerName = designerNameFromSpecs || designerProfileName;
  const assignedToName = designerName || ownerProfileName || "—";
  const assignedToEmail = designerEmail || ownerEmail;

  return {
    order,
    columnName: (column as BoardColumn | null)?.name ?? "—",
    tagName: order.tag?.name ?? null,
    fieldValues,
    customFields,
    skus,
    skuRows,
    specRows: buildSpecRows(customFields, fieldValues),
    totalQty,
    customerName: customerName === "there" ? "—" : customerName,
    customerEmail: contact.email ?? order.customer?.email ?? null,
    customerPhone: contact.phone ?? order.customer?.phone ?? null,
    customerContact,
    artworkLink,
    designTask:
      typeof order.specs?.design_task === "string"
        ? order.specs.design_task.trim()
        : "",
    ownerName: ownerProfileName,
    ownerEmail,
    designerName,
    designerEmail,
    assignedToName,
    assignedToEmail,
    product: productFromOrder(fieldValues, customFields),
    die: (() => {
      const dieField = findOrderFormField(customFields, "Die");
      return dieField ? String(fieldValues[dieField.id] ?? "").trim() : "";
    })(),
    orderNumber: order.title,
    dueDateFormatted: order.due_date ? formatDate(order.due_date) : "—",
    priority: order.priority,
    tenantName,
  };
}

export async function assertButtonVisibleForOrder(
  supabase: SupabaseClient,
  buttonId: string,
  tenantId: string,
  columnId: string,
  expectedAction: "send_email" | "send_sms" | "generate_pdf"
) {
  const { data, error } = await supabase
    .from("button_automations")
    .select("*")
    .eq("id", buttonId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || !data) {
    return { error: "Button not found", button: null as null };
  }

  const button = data as import("@/lib/types").ButtonAutomation;
  if (!button.enabled) {
    return { error: "Button is disabled", button: null as null };
  }
  if (button.action_type !== expectedAction) {
    return { error: "Invalid button action", button: null as null };
  }
  if (
    button.column_ids.length > 0 &&
    !button.column_ids.includes(columnId)
  ) {
    return { error: "Button not available for this column", button: null as null };
  }

  return { error: null, button };
}
