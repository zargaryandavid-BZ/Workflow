/**
 * Cross-system order numbers on a card (no app aliases — safe for node:test).
 *
 * One order can carry three numbers: website/portal `#529`, Workflow card
 * `BZ-529`, CRM `ORD-2026-15643`. The inbound webhook may send the "other"
 * numbers so the card can show them together:
 *
 *   crm_order_number    → specs.crm_order_number    (e.g. "ORD-2026-15643")
 *   portal_order_number → specs.portal_order_number (e.g. "BZ-529")
 *
 * Additive only: a key is set when the payload sends a valid non-empty value;
 * it is never cleared and no other spec key is touched.
 */

import { compactOrderNumberToken } from "./order-number-tokens.ts";

export const LINKED_ORDER_NUMBER_MAX_LEN = 40;
const LINKED_ORDER_NUMBER_RE = /^[A-Za-z0-9-]+$/;

export type LinkedOrderNumberKey = "crm_order_number" | "portal_order_number";
export const LINKED_ORDER_NUMBER_KEYS: readonly LinkedOrderNumberKey[] = [
  "crm_order_number",
  "portal_order_number",
];

export type LinkedOrderNumbers = Partial<Record<LinkedOrderNumberKey, string>>;

/** Trimmed value when it is 1–40 chars of letters, digits and dashes; else null. */
export function parseLinkedOrderNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > LINKED_ORDER_NUMBER_MAX_LEN) return null;
  return LINKED_ORDER_NUMBER_RE.test(value) ? value : null;
}

/**
 * Linked numbers from a webhook payload. Item-level values override
 * order-level ones; invalid/empty values are ignored (fall back to order level).
 */
export function linkedOrderNumbersFromWebhook(
  body: Record<string, unknown> | null | undefined,
  item?: Record<string, unknown> | null
): LinkedOrderNumbers {
  const out: LinkedOrderNumbers = {};
  for (const key of LINKED_ORDER_NUMBER_KEYS) {
    const value =
      parseLinkedOrderNumber(item?.[key]) ?? parseLinkedOrderNumber(body?.[key]);
    if (value) out[key] = value;
  }
  return out;
}

/**
 * Stamp linked numbers onto `specs` (mutates + returns it). Only keys present
 * in `numbers` are written; existing values are never cleared.
 * Returns true when anything changed.
 */
export function applyLinkedOrderNumbers(
  specs: Record<string, unknown>,
  numbers: LinkedOrderNumbers
): boolean {
  let changed = false;
  for (const key of LINKED_ORDER_NUMBER_KEYS) {
    const value = numbers[key];
    if (value && specs[key] !== value) {
      specs[key] = value;
      changed = true;
    }
  }
  return changed;
}

function specString(
  specs: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  return parseLinkedOrderNumber(specs?.[key]);
}

/** True when the card title already IS this number (e.g. `0723-1` vs `ORD-2026-0723`). */
function titleIsNumber(title: string, number: string): boolean {
  const t = compactOrderNumberToken(title);
  const n = compactOrderNumberToken(number);
  if (!t || !n) return false;
  return t === n || t.startsWith(`${n}-`);
}

/**
 * Small secondary labels for the card: `CRM ORD-2026-15643` on a portal/website
 * card, `Portal BZ-529` on a CRM card. A number the title already shows is skipped.
 * Portal falls back to the existing `specs.bazaar_order_number` (portal intake).
 */
export function cardLinkedNumberLabels(
  title: string | null | undefined,
  specs: Record<string, unknown> | null | undefined
): string[] {
  const cardTitle = (title ?? "").trim();
  const labels: string[] = [];
  const crm = specString(specs, "crm_order_number");
  if (crm && !titleIsNumber(cardTitle, crm)) labels.push(`CRM ${crm}`);
  const portal =
    specString(specs, "portal_order_number") ??
    specString(specs, "bazaar_order_number");
  if (portal && !titleIsNumber(cardTitle, portal)) labels.push(`Portal ${portal}`);
  return labels;
}
