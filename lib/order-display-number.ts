/**
 * Staff-facing order number for a board card (UI only — never written back).
 *
 * Broker-portal cards are stored with the portal number as their title
 * (`BZ-667`, `BZ-667-2`) because the portal sync matches cards by that title /
 * `specs.webhook_order_number`. Customers and partners now quote the CRM
 * number (`ORD-2026-15844` → "15844"), so when a portal card also carries
 * `specs.crm_order_number` we DISPLAY it like a CRM card:
 *
 *   title `BZ-667`   + crm `ORD-2026-15844` → primary `15844`,   secondary `Portal BZ-667`
 *   title `BZ-667-2` + crm `ORD-2026-15844` → primary `15844-2`, secondary `Portal BZ-667-2`
 *
 * Every other card (CRM `15784-1`, website, manual, renamed titles, portal card
 * without a CRM number) keeps its normal short number and no override.
 */

import { formatShortOrderNumber } from "./order-number-tokens.ts";

export interface DisplayOrderNumber {
  /** Main order number shown on the card / row / modal header. */
  primary: string;
  /** Small grey label for the stored portal number, or null when unchanged. */
  secondary: string | null;
  /** True when the primary is the CRM number standing in for a `BZ-…` title. */
  portalAsCrm: boolean;
}

const PORTAL_TITLE_RE = /^BZ-(\d+)(?:-(\d+))?$/i;
const CRM_NUMBER_RE = /^(?:ORD-\d{4}-)?0*(\d+)(?:-\d+)?$/i;

function specsRecord(specs: unknown): Record<string, unknown> | null {
  return specs && typeof specs === "object"
    ? (specs as Record<string, unknown>)
    : null;
}

/** CRM base digits from `specs.crm_order_number` (`ORD-2026-15844` → `15844`), else null. */
export function crmBaseNumber(specs: unknown): string | null {
  const raw = specsRecord(specs)?.crm_order_number;
  if (typeof raw !== "string") return null;
  const m = CRM_NUMBER_RE.exec(raw.trim());
  return m?.[1] ?? null;
}

export function displayOrderNumber(order: {
  title: string | null | undefined;
  specs?: unknown;
}): DisplayOrderNumber {
  const title = (order.title ?? "").trim();
  const portal = PORTAL_TITLE_RE.exec(title);
  const crm = portal ? crmBaseNumber(order.specs) : null;
  if (portal && crm) {
    const suffix = portal[2] ? `-${portal[2]}` : "";
    return {
      primary: `${crm}${suffix}`,
      secondary: `Portal ${title.toUpperCase()}`,
      portalAsCrm: true,
    };
  }
  return {
    primary: formatShortOrderNumber(title),
    secondary: null,
    portalAsCrm: false,
  };
}

/** Shorthand for the primary number (drop-in for `formatShortOrderNumber(order.title)`). */
export function displayOrderNumberText(order: {
  title: string | null | undefined;
  specs?: unknown;
}): string {
  return displayOrderNumber(order).primary;
}
