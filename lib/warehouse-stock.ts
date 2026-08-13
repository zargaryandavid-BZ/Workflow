/**
 * "With Application" warehouse stock gate (pure helpers — safe to import
 * anywhere, no server-only deps).
 *
 * Bazaar "combo" orders = a container (bag / jar / tube) + a printed label that
 * gets APPLIED onto the container. These arrive from the CRM as `application: true`
 * (mapped to the Product-box "Application" checkbox / `specs.application`) and/or
 * the Combos product category. Such an order must NOT reach Ready-to-Ship or be
 * released for pickup until the warehouse confirms the physical containers are in
 * stock — otherwise labels get printed with nothing to apply them to.
 *
 * Confirmation state lives additively on `orders.specs` (jsonb) — no schema change:
 * - warehouse_stock_confirmed        : boolean (gate opens when true)
 * - warehouse_stock_confirmed_at     : ISO timestamp
 * - warehouse_stock_confirmed_by     : who confirmed (user id / name / "warehouse-sms")
 * - warehouse_stock_sms_sent_at      : ISO timestamp (dedupe the warehouse text)
 * - warehouse_stock_confirm_secret   : unguessable token for the no-login confirm link
 */

import { CATEGORY_FIELD_NAME } from "@/lib/constants";
import { findOrderFormField } from "@/lib/order-form";
import { isApplicationEnabled } from "@/lib/order-application";
import { PRODUCT_CATEGORIES } from "@/lib/product-data";
import type { CustomField } from "@/lib/types";

const COMBO_CATEGORY = "Combos";
const PRODUCT_FIELD_NAME = "Product";
const COMBO_PRODUCTS = new Set(
  (PRODUCT_CATEGORIES[COMBO_CATEGORY] ?? []).map((p) => p.toLowerCase())
);

export interface WarehouseStockSpecs {
  warehouse_stock_confirmed?: boolean;
  warehouse_stock_confirmed_at?: string | null;
  warehouse_stock_confirmed_by?: string | null;
  warehouse_stock_sms_sent_at?: string | null;
  warehouse_stock_confirm_secret?: string | null;
}

function asRecord(specs: unknown): Record<string, unknown> {
  if (!specs || typeof specs !== "object") return {};
  return specs as Record<string, unknown>;
}

/**
 * True when the order is a "with application" job (container + label to apply).
 * Primary signal is the Product-box "Application" checkbox / `specs.application`
 * (the CRM `application` flag). Combos category / combo product is a safety net
 * in case a combo arrives without the flag set.
 */
export function orderIsWithApplication(
  specs: unknown,
  customFields?: CustomField[],
  fieldValues?: Record<string, unknown>
): boolean {
  if (isApplicationEnabled(specs, customFields, fieldValues)) return true;

  if (customFields && fieldValues) {
    const categoryField = findOrderFormField(customFields, CATEGORY_FIELD_NAME);
    if (categoryField) {
      const val = fieldValues[categoryField.id];
      if (
        typeof val === "string" &&
        val.trim().toLowerCase() === COMBO_CATEGORY.toLowerCase()
      ) {
        return true;
      }
    }

    const productField = findOrderFormField(customFields, PRODUCT_FIELD_NAME);
    if (productField) {
      const val = fieldValues[productField.id];
      if (typeof val === "string" && COMBO_PRODUCTS.has(val.trim().toLowerCase())) {
        return true;
      }
    }
  }

  return false;
}

/** Warehouse has confirmed the containers are physically in stock. */
export function warehouseStockConfirmed(specs: unknown): boolean {
  return asRecord(specs).warehouse_stock_confirmed === true;
}

/** True when the warehouse has already been texted for this order. */
export function warehouseStockSmsSent(specs: unknown): boolean {
  return Boolean(asRecord(specs).warehouse_stock_sms_sent_at);
}

/**
 * A with-application order that has NOT yet had warehouse stock confirmed must
 * not advance into Ready-to-Ship / be released for pickup.
 */
export function requiresStockConfirmationBeforeShip(
  specs: unknown,
  customFields?: CustomField[],
  fieldValues?: Record<string, unknown>
): boolean {
  return (
    orderIsWithApplication(specs, customFields, fieldValues) &&
    !warehouseStockConfirmed(specs)
  );
}

/** Column kinds that represent the fulfilled / shippable stages the gate protects. */
export function isShipStageKind(kind: string | null | undefined): boolean {
  return kind === "ready_to_ship" || kind === "done";
}

export const STOCK_GATE_MESSAGE =
  "This combo order needs application. The warehouse must confirm the containers are in stock before it can move to Ready to Ship or be released for pickup.";
