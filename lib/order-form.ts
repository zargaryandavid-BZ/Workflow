import type { CustomField } from "@/lib/types";
import { isPastDateInputValue } from "@/lib/utils";
import { skuCountFromSpecs, skuQtySumFromSpecs } from "@/lib/skus";
import {
  ARTWORK_FIELD_NAME,
  CUSTOMER_CONTACT_FIELD_NAME,
  CUSTOMER_NAME_FIELD_NAME,
  DESIGNER_FIELD_NAME,
  ORDER_QTY_FIELD_NAME,
} from "@/lib/constants";

/** Print fields after customer / designer, in display order on create + edit forms. */
export const ORDER_FORM_PRINT_FIELD_NAMES = [
  "Product",
  "Materials",
  "Finished Size",
  "Die",
  "Finishing",
  "Sides",
  "Position",
  "Color",
] as const;

/** Labels that differ from the stored custom-field name. */
export const ORDER_FORM_FIELD_LABELS: Record<string, string> = {
  "Artwork (GDrive link)": "Artwork (Client See)",
};

/** Always required on the order form regardless of the custom-field toggle. */
export const ORDER_FORM_ALWAYS_REQUIRED = [
  CUSTOMER_NAME_FIELD_NAME,
  CUSTOMER_CONTACT_FIELD_NAME,
  "Product",
  "Finished Size",
  "Materials",
] as const;

export function orderFormFieldLabel(name: string): string {
  return ORDER_FORM_FIELD_LABELS[name] ?? name;
}

export function isEmptyFieldValue(v: unknown): boolean {
  return v === null || v === undefined || v === "" || v === false;
}

export function isValidCustomerContact(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v.includes("@")) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.toLowerCase());
  }
  const digits = v.replace(/\D/g, "");
  return digits.length >= 7;
}

export function validateCustomerFields(
  name: string,
  contact: string
): string | null {
  if (!name.trim()) return "Customer Name is required";
  if (!contact.trim() || !isValidCustomerContact(contact)) {
    return "Please add an email or phone number";
  }
  return null;
}

export function findOrderFormField(
  fields: CustomField[],
  name: string
): CustomField | undefined {
  const lower = name.toLowerCase();
  return fields.find((f) => f.name.toLowerCase() === lower);
}

export function resolveOrderFormFields(customFields: CustomField[]) {
  const artworkField = findOrderFormField(customFields, ARTWORK_FIELD_NAME);
  const customerNameField = findOrderFormField(
    customFields,
    CUSTOMER_NAME_FIELD_NAME
  );
  const customerContactField = findOrderFormField(
    customFields,
    CUSTOMER_CONTACT_FIELD_NAME
  );
  const orderQtyField = findOrderFormField(customFields, ORDER_QTY_FIELD_NAME);

  const reserved = new Set(
    [
      DESIGNER_FIELD_NAME,
      ARTWORK_FIELD_NAME,
      CUSTOMER_NAME_FIELD_NAME,
      CUSTOMER_CONTACT_FIELD_NAME,
      ORDER_QTY_FIELD_NAME,
    ].map((n) => n.toLowerCase())
  );

  const byName = new Map(
    customFields
      .filter((f) => !reserved.has(f.name.toLowerCase()))
      .map((f) => [f.name.toLowerCase(), f])
  );

  const printFields: CustomField[] = [];
  const seenPrintNames = new Set<string>();
  for (const name of ORDER_FORM_PRINT_FIELD_NAMES) {
    const field = byName.get(name.toLowerCase());
    if (!field) continue;
    const key = field.name.toLowerCase();
    if (seenPrintNames.has(key)) continue;
    seenPrintNames.add(key);
    printFields.push(field);
  }
  for (const field of customFields) {
    if (reserved.has(field.name.toLowerCase())) continue;
    if (printFields.some((f) => f.id === field.id)) continue;
    const key = field.name.toLowerCase();
    if (seenPrintNames.has(key)) continue;
    seenPrintNames.add(key);
    printFields.push(field);
  }

  return {
    artworkField,
    customerNameField,
    customerContactField,
    designerField: findOrderFormField(customFields, DESIGNER_FIELD_NAME),
    orderQtyField,
    printFields,
  };
}

export function computeOrderQty(
  skus: { qty?: number | null }[],
  manualQty: unknown
): number | null {
  if (skus.length > 0) {
    return skus.reduce(
      (sum, s) =>
        sum + (typeof s.qty === "number" && !Number.isNaN(s.qty) ? s.qty : 0),
      0
    );
  }
  if (typeof manualQty === "number" && !Number.isNaN(manualQty)) return manualQty;
  if (manualQty !== null && manualQty !== undefined && manualQty !== "") {
    const n = Number(manualQty);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

export function validateOrderQtyValue(qty: number | null): string | null {
  if (qty == null || qty < 1) {
    return "Order QTY must be at least 1.";
  }
  return null;
}

export function validateOrderQty(
  orderQtyField: CustomField | undefined,
  fieldValues: Record<string, unknown>,
  skus: { qty?: number | null }[]
): string | null {
  if (!orderQtyField) return null;
  return validateOrderQtyValue(
    computeOrderQty(skus, fieldValues[orderQtyField.id])
  );
}

export function validateOrderQtyFromPayload(
  orderQtyFieldId: string | undefined,
  customFieldValues: { customFieldId: string; value: unknown }[] | undefined,
  skus: { qty?: number | null }[]
): string | null {
  if (!orderQtyFieldId) return null;
  const manualQty = (customFieldValues ?? []).find(
    (v) => v.customFieldId === orderQtyFieldId
  )?.value;
  return validateOrderQtyValue(computeOrderQty(skus, manualQty));
}

export function validateOrderFormFields(
  fields: {
    artworkField?: CustomField;
    customerNameField?: CustomField;
    customerContactField?: CustomField;
    designerField?: CustomField;
    orderQtyField?: CustomField;
    printFields: CustomField[];
  },
  fieldValues: Record<string, unknown>,
  customerName: string,
  customerContact: string,
  skus: { qty?: number | null }[] = [],
  designerId?: string
): string | null {
  const customerErr = validateCustomerFields(customerName, customerContact);
  if (customerErr) return customerErr;

  const requiredNames = new Set<string>(
    ORDER_FORM_ALWAYS_REQUIRED.map((n) => n.toLowerCase())
  );

  const toCheck: CustomField[] = [...fields.printFields];
  if (fields.artworkField) toCheck.push(fields.artworkField);

  // #region agent log
  fetch('http://127.0.0.1:7557/ingest/19f28f15-fbcc-4f8f-ac21-080af04100d0',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'44dc29'},body:JSON.stringify({sessionId:'44dc29',location:'order-form.ts:validateOrderFormFields',message:'required-check',hypothesisId:'A',data:{alwaysRequired:[...requiredNames],fields:toCheck.map(f=>({name:f.name,dbRequired:f.required,inAlwaysRequired:requiredNames.has(f.name.toLowerCase()),empty:isEmptyFieldValue(fieldValues[f.id])}))},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  const missing = toCheck.filter((f) => {
    const must =
      requiredNames.has(f.name.toLowerCase()) || f.required;
    return must && isEmptyFieldValue(fieldValues[f.id]);
  });

  if (
    fields.designerField?.required &&
    !(designerId && designerId.trim())
  ) {
    missing.push(fields.designerField);
  }

  if (missing.length > 0) {
    return `Please fill required field(s): ${missing.map((f) => orderFormFieldLabel(f.name)).join(", ")}`;
  }

  return validateOrderQty(fields.orderQtyField, fieldValues, skus);
}

export function validateDueDate(
  dueDate: string | null | undefined,
  previousDueDate?: string | null
): string | null {
  const value = dueDate?.trim();
  if (!value) return null;
  const normalized = value.slice(0, 10);
  const previous = previousDueDate?.trim().slice(0, 10);
  if (previous && normalized === previous) return null;
  if (isPastDateInputValue(normalized)) {
    return "Due date cannot be in the past.";
  }
  return null;
}

export function buildCustomFieldPayload(
  resolved: ReturnType<typeof resolveOrderFormFields>,
  fieldValues: Record<string, unknown>,
  skus: { qty?: number | null }[],
  customerName: string,
  customerContact: string
): { customFieldId: string; value: unknown }[] {
  const rows: { customFieldId: string; value: unknown }[] = [];

  if (resolved.customerNameField) {
    rows.push({
      customFieldId: resolved.customerNameField.id,
      value: customerName.trim(),
    });
  }
  if (resolved.customerContactField) {
    rows.push({
      customFieldId: resolved.customerContactField.id,
      value: customerContact.trim(),
    });
  }

  for (const field of resolved.printFields) {
    rows.push({
      customFieldId: field.id,
      value: fieldValues[field.id] ?? null,
    });
  }

  if (resolved.artworkField) {
    rows.push({
      customFieldId: resolved.artworkField.id,
      value: fieldValues[resolved.artworkField.id] ?? null,
    });
  }

  if (resolved.orderQtyField) {
    const skuSum = skus.reduce((sum, s) => sum + (s.qty ?? 0), 0);
    rows.push({
      customFieldId: resolved.orderQtyField.id,
      value:
        skus.length > 0
          ? skuSum
          : (fieldValues[resolved.orderQtyField.id] ?? null),
    });
  }

  return rows;
}

/** Print spec fields shown as chips on board order cards (excludes customer/contact/artwork/qty). */
export const CARD_SPEC_FIELD_NAMES = [
  ...ORDER_FORM_PRINT_FIELD_NAMES,
] as const;

export function cardOrderQty(
  customFields: CustomField[],
  fieldValues: Record<string, unknown>,
  specs: unknown
): number | null {
  const skuCount = skuCountFromSpecs(specs);
  if (skuCount > 0) return skuQtySumFromSpecs(specs);

  const field = findOrderFormField(customFields, ORDER_QTY_FIELD_NAME);
  if (!field) return null;
  const raw = fieldValues[field.id];
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
  if (raw !== null && raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

export function cardSkuCount(specs: unknown): number {
  return skuCountFromSpecs(specs);
}

export function cardSpecFieldsForDisplay(
  customFields: CustomField[],
  fieldValues: Record<string, unknown>
): { field: CustomField; label: string; display: string }[] {
  const byName = new Map(
    customFields.map((f) => [f.name.toLowerCase(), f])
  );
  const rows: { field: CustomField; label: string; display: string }[] = [];

  for (const name of CARD_SPEC_FIELD_NAMES) {
    const field = byName.get(name.toLowerCase());
    if (!field) continue;
    const raw = fieldValues[field.id];
    if (isEmptyFieldValue(raw)) continue;
    const display =
      typeof raw === "boolean" ? (raw ? "Yes" : "No") : String(raw);
    rows.push({
      field,
      label: orderFormFieldLabel(field.name),
      display,
    });
  }

  return rows;
}
