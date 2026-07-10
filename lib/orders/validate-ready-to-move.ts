import {
  isEmptyFieldValue,
  orderFormFieldLabel,
} from "@/lib/order-form";
import {
  CUSTOMER_CONTACT_FIELD_NAME,
  CUSTOMER_NAME_FIELD_NAME,
  DESIGNER_FIELD_NAME,
  ORDER_QTY_FIELD_NAME,
} from "@/lib/constants";
import {
  customerContactFromOrder,
  customerNameFromOrder,
} from "@/lib/notification-messages";
import { skuCountFromSpecs } from "@/lib/skus";
import type { CustomField, OrderWithRelations } from "@/lib/types";

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

  // Respect each custom field's required toggle from Settings → Fields.
  for (const field of customFields) {
    if (!field.required) continue;

    const nameLower = field.name.toLowerCase();

    if (nameLower === CUSTOMER_NAME_FIELD_NAME.toLowerCase()) {
      const customerName = customerNameFromOrder(
        order,
        fieldValues,
        customFields
      );
      if (!customerName || customerName === "there") {
        missing.push({
          label: orderFormFieldLabel(field.name),
          field: "customer_name",
        });
      }
      continue;
    }

    if (nameLower === CUSTOMER_CONTACT_FIELD_NAME.toLowerCase()) {
      const { email, phone } = customerContactFromOrder(
        order,
        fieldValues,
        customFields
      );
      if (!email && !phone) {
        missing.push({
          label: orderFormFieldLabel(field.name),
          field: "customer_contact",
        });
      }
      continue;
    }

    if (nameLower === DESIGNER_FIELD_NAME.toLowerCase()) {
      const designerId = order.specs?.designer_id;
      if (typeof designerId !== "string" || !designerId.trim()) {
        missing.push({
          label: orderFormFieldLabel(field.name),
          field: "designer",
        });
      }
      continue;
    }

    if (nameLower === ORDER_QTY_FIELD_NAME.toLowerCase()) {
      if (skuCountFromSpecs(order.specs) > 0) continue;
      if (isEmptyFieldValue(fieldValues[field.id])) {
        missing.push({
          label: orderFormFieldLabel(field.name),
          field: fieldKey(field.name),
        });
      }
      continue;
    }

    if (isEmptyFieldValue(fieldValues[field.id])) {
      missing.push({
        label: orderFormFieldLabel(field.name),
        field: fieldKey(field.name),
      });
    }
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
