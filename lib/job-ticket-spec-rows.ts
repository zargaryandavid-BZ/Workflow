import {
  ARTWORK_FIELD_NAME,
  CUSTOMER_CONTACT_FIELD_NAME,
  CUSTOMER_NAME_FIELD_NAME,
  DESIGNER_FIELD_NAME,
} from "./constants.ts";
import {
  findOrderFormField,
  formatFieldDisplayValue,
  orderFormFieldLabel,
  ORDER_FORM_PRINT_FIELD_NAMES,
  resolveOrderFormFields,
} from "./order-form.ts";
import { webhookSpecRowsForJobTicket } from "./product-spec-options.ts";
import type { SkuItem } from "./skus.ts";
import type { CustomField } from "./types.ts";

export type JobTicketSpecRow = { label: string; value: string };

function checkboxToYesNo(raw: unknown): "Yes" | "No" {
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  if (typeof raw === "number") return raw === 1 ? "Yes" : "No";
  if (typeof raw === "string") {
    const value = raw.trim().toLowerCase();
    if (["true", "yes", "1", "on", "checked"].includes(value)) return "Yes";
  }
  return "No";
}

function rowValue(field: CustomField, raw: unknown): string {
  return field.field_type === "checkbox"
    ? checkboxToYesNo(raw)
    : formatFieldDisplayValue(raw).trim();
}

/**
 * Product-specification rows matching everything visible on the cardboard:
 * custom fields, catalog/webhook specs, calculated quantity, and SKU rows.
 */
export function buildJobTicketSpecRows(args: {
  customFields: CustomField[];
  fieldValues: Record<string, unknown>;
  specs?: Record<string, unknown> | null;
  skus?: SkuItem[];
}): JobTicketSpecRow[] {
  const { customFields, fieldValues, specs } = args;
  const skus = args.skus ?? [];
  const resolvedFields = resolveOrderFormFields(customFields);
  const visibleFields = resolvedFields.printFields;
  const skip = new Set(
    [
      CUSTOMER_NAME_FIELD_NAME,
      CUSTOMER_CONTACT_FIELD_NAME,
      ARTWORK_FIELD_NAME,
      DESIGNER_FIELD_NAME,
      "designer",
      "Unit Price",
      "Unit Price ($)",
    ].map((name) => name.toLowerCase())
  );
  const rows: JobTicketSpecRow[] = [];
  const usedFieldIds = new Set<string>();

  const appendField = (field: CustomField) => {
    if (usedFieldIds.has(field.id) || skip.has(field.name.toLowerCase())) return;
    const raw = fieldValues[field.id];
    if (
      field.field_type !== "checkbox" &&
      (raw === null || raw === undefined || raw === "")
    ) {
      return;
    }
    const value = rowValue(field, raw);
    if (!value && field.field_type !== "checkbox") return;
    const label =
      field.name.toLowerCase() === "die cut" && field.field_type === "text"
        ? "Die"
        : orderFormFieldLabel(field.name);
    rows.push({ label, value });
    usedFieldIds.add(field.id);
  };

  // Preserve the same primary field order as the cardboard. Width, Height, and
  // Depth stay separate instead of being collapsed into one Size row.
  for (const name of ORDER_FORM_PRINT_FIELD_NAMES) {
    const field = findOrderFormField(visibleFields, name);
    if (field) appendField(field);
  }
  for (const field of visibleFields) appendField(field);

  // Suppress any webhook row whose normalized label is already covered by a
  // custom field — regardless of value. "Material" is suppressed when
  // "Materials" is already there; "Size" is suppressed when "Width"+"Height"
  // are. This prevents the webhook's spec_selections (and spec_display) from
  // duplicating information the staff already filled in on the card.
  function normLabel(label: string): string {
    return label.replace(/[\s-]+/g, " ").trim().toLowerCase();
  }
  const usedLabels = new Set(rows.map((r) => normLabel(r.label)));
  for (const row of webhookSpecRowsForJobTicket(specs)) {
    const key = normLabel(row.label);
    if (usedLabels.has(key)) continue;
    usedLabels.add(key);
    rows.push(row);
  }

  const hasQuantity = rows.some((row) =>
    ["quantity", "qty", "order qty"].includes(row.label.trim().toLowerCase())
  );
  const totalQty = skus.reduce(
    (sum, sku) => sum + (typeof sku.qty === "number" ? sku.qty : 0),
    0
  );
  const manualQtyRaw = resolvedFields.orderQtyField
    ? fieldValues[resolvedFields.orderQtyField.id]
    : null;
  const manualQty = Number(manualQtyRaw);
  const quantity =
    totalQty > 0
      ? totalQty
      : Number.isFinite(manualQty) && manualQty > 0
        ? manualQty
        : 0;
  if (!hasQuantity && quantity > 0) {
    rows.push({ label: "Quantity", value: quantity.toLocaleString("en-US") });
  }

  const configuredSkuCount = Number(specs?.sku_qty);
  const skuCount =
    Number.isFinite(configuredSkuCount) && configuredSkuCount > 0
      ? Math.floor(configuredSkuCount)
      : skus.length;
  if (skuCount > 0) {
    rows.push({ label: "SKU Qty", value: String(skuCount) });
  }
  skus.forEach((sku, index) => {
    const name = sku.name.trim() || `SKU ${index + 1}`;
    const qty =
      typeof sku.qty === "number"
        ? sku.qty.toLocaleString("en-US")
        : "—";
    rows.push({ label: `SKU ${index + 1}`, value: `${name} · Qty ${qty}` });
  });

  return rows;
}
