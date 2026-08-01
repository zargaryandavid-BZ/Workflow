/**
 * Order Application (laminating / rollers) helpers.
 *
 * ON/OFF comes from the Product-box custom field "Application" (checkbox).
 * Extra metadata on `orders.specs`:
 * - application: mirrored boolean for card/PDF convenience
 * - application_days: working days required for application
 *
 * Production date = due date − application_days (Mon–Sat; Sunday skipped).
 */

import { findOrderFormField } from "@/lib/order-form";
import type { CustomField } from "@/lib/types";

export const DEFAULT_APPLICATION_DAYS = 1;
export const APPLICATION_FIELD_NAME = "Application";

export interface OrderApplicationSpecs {
  application?: boolean;
  application_days?: number | null;
}

function asRecord(specs: unknown): Record<string, unknown> {
  if (!specs || typeof specs !== "object") return {};
  return specs as Record<string, unknown>;
}

/** Product-box Application checkbox value. */
export function isApplicationCustomFieldOn(
  customFields: CustomField[],
  fieldValues: Record<string, unknown>
): boolean {
  const field = findOrderFormField(customFields, APPLICATION_FIELD_NAME);
  if (!field) return false;
  return fieldValues[field.id] === true;
}

/**
 * Prefer Product-box custom field when provided; else specs.application.
 */
export function isApplicationEnabled(
  specs: unknown,
  customFields?: CustomField[],
  fieldValues?: Record<string, unknown>
): boolean {
  if (customFields && fieldValues) {
    const field = findOrderFormField(customFields, APPLICATION_FIELD_NAME);
    if (field) return fieldValues[field.id] === true;
  }
  return asRecord(specs).application === true;
}

/** Positive integer days, or null when unset/invalid. */
export function applicationDaysFromSpecs(specs: unknown): number | null {
  const raw = asRecord(specs).application_days;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const n = Math.floor(raw);
    return n >= 1 ? n : null;
  }
  if (typeof raw === "string" && raw.trim()) {
    const n = Math.floor(Number(raw.trim()));
    return Number.isFinite(n) && n >= 1 ? n : null;
  }
  return null;
}

/**
 * Subtract N Mon–Sat working days from a calendar date (skip Sunday only).
 */
export function subtractMonSatWorkingDays(
  startDateYmd: string,
  workingDays: number
): string | null {
  const y = Number(startDateYmd.slice(0, 4));
  const m = Number(startDateYmd.slice(5, 7)) - 1;
  const d = Number(startDateYmd.slice(8, 10));
  const date = new Date(y, m, d);
  if (Number.isNaN(date.getTime())) return null;

  let remaining = Math.max(0, Math.floor(workingDays));
  while (remaining > 0) {
    date.setDate(date.getDate() - 1);
    const day = date.getDay(); // 0 Sun … 6 Sat
    if (day !== 0) remaining -= 1;
  }

  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Production date = due date − applicationDays (Mon–Sat working days).
 */
export function productionDateFromDueDate(
  dueDate: string | null | undefined,
  applicationDays: number = DEFAULT_APPLICATION_DAYS
): string | null {
  const ymd = dueDate?.trim().slice(0, 10);
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const days = Math.max(1, Math.floor(applicationDays));
  return subtractMonSatWorkingDays(ymd, days);
}

export function mergeApplicationIntoOrderSpecs(
  existingSpecs: unknown,
  application: boolean,
  applicationDays: number | null
): Record<string, unknown> {
  const base = { ...asRecord(existingSpecs) };
  delete base.application_date;
  if (application) {
    base.application = true;
    const days =
      applicationDays != null &&
      Number.isFinite(applicationDays) &&
      applicationDays >= 1
        ? Math.floor(applicationDays)
        : DEFAULT_APPLICATION_DAYS;
    base.application_days = days;
  } else {
    delete base.application;
    delete base.application_days;
  }
  return base;
}
