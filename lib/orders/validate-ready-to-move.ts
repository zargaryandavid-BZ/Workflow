import {
  findOrderFormField,
  isEmptyFieldValue,
  orderFormFieldLabel,
} from "@/lib/order-form";
import {
  customerContactFromOrder,
  customerNameFromOrder,
} from "@/lib/notification-messages";
import { skuCountFromSpecs } from "@/lib/skus";
import type { CustomField, OrderWithRelations } from "@/lib/types";

const MOVE_REQUIRED_PRINT_FIELDS = [
  "Product",
  "Product Type",
  "Finished Size",
  "Materials",
  "Finishing",
  "Sides",
  "Color",
] as const;

export interface MissingField {
  label: string;
  field: string;
}

function fieldKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

export function getMissingFields(
  order: OrderWithRelations,
  fieldValues: Record<string, unknown>,
  customFields: CustomField[]
): MissingField[] {
  const missing: MissingField[] = [];

  const customerName = customerNameFromOrder(order, fieldValues, customFields);
  if (!customerName || customerName === "there") {
    missing.push({ label: "Customer Name", field: "customer_name" });
  }

  const { email, phone } = customerContactFromOrder(
    order,
    fieldValues,
    customFields
  );
  if (!email && !phone) {
    missing.push({
      label: "Customer Contact (email or phone)",
      field: "customer_contact",
    });
  }

  for (const name of MOVE_REQUIRED_PRINT_FIELDS) {
    const field = findOrderFormField(customFields, name);
    if (!field) continue;
    if (isEmptyFieldValue(fieldValues[field.id])) {
      missing.push({
        label: orderFormFieldLabel(name),
        field: fieldKey(name),
      });
    }
  }

  if (!order.due_date) {
    missing.push({ label: "Due Date", field: "due_date" });
  }

  if (skuCountFromSpecs(order.specs) === 0) {
    missing.push({ label: "At least one SKU", field: "skus" });
  }

  return missing;
}

export function isReadyToMove(
  order: OrderWithRelations,
  fieldValues: Record<string, unknown>,
  customFields: CustomField[]
): boolean {
  return getMissingFields(order, fieldValues, customFields).length === 0;
}

export function missingFieldsFromLabels(labels: string[]): MissingField[] {
  return labels.map((label) => ({
    label,
    field: fieldKey(label),
  }));
}
