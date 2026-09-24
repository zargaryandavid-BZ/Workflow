/** Ready to Ship column: filter cards by shipping choice. */

export type ReadyToShipShippingFilter =
  | "all"
  | "pickup"
  | "fedex"
  | "self_fedex"
  | "uber"
  | "awaiting"
  | "not_sent";

/** All valid filter values (used for validation). */
export const READY_TO_SHIP_SHIPPING_OPTIONS: {
  value: ReadyToShipShippingFilter;
  label: string;
}[] = [
  { value: "all",       label: "All" },
  { value: "pickup",    label: "Pickup" },
  { value: "fedex",     label: "FedEx" },
  { value: "self_fedex",label: "Self FedEx" },
  { value: "uber",      label: "Uber" },
  { value: "awaiting",  label: "Awaiting" },
  { value: "not_sent",  label: "Not Sent" },
];

/** Boyd Only (ready-to-ship) column: pre-send status filters. */
export const RTS_FILTER_OPTIONS_BOYD: {
  value: ReadyToShipShippingFilter;
  label: string;
}[] = [
  { value: "all",      label: "All" },
  { value: "awaiting", label: "Awaiting" },
  { value: "not_sent", label: "Not Sent" },
];

/** Ship Opt Selected column: post-selection method filters. */
export const RTS_FILTER_OPTIONS_SHIP_OPT: {
  value: ReadyToShipShippingFilter;
  label: string;
}[] = [
  { value: "all",       label: "All" },
  { value: "pickup",    label: "Pickup" },
  { value: "fedex",     label: "FedEx" },
  { value: "self_fedex",label: "Self FedEx" },
  { value: "uber",      label: "Uber" },
];

const RTS_FILTERS = new Set<ReadyToShipShippingFilter>(
  READY_TO_SHIP_SHIPPING_OPTIONS.map((o) => o.value)
);

export function isReadyToShipShippingFilter(
  value: unknown
): value is ReadyToShipShippingFilter {
  return (
    typeof value === "string" &&
    RTS_FILTERS.has(value as ReadyToShipShippingFilter)
  );
}

export function orderMatchesReadyToShipShippingFilter(
  sign: { kind: string } | null | undefined,
  filter: ReadyToShipShippingFilter
): boolean {
  if (filter === "all") return true;
  if (filter === "not_sent") return !sign;
  if (filter === "pickup") return sign?.kind === "pickup";
  if (filter === "self_fedex") return sign?.kind === "client_fedex";
  if (filter === "uber") return sign?.kind === "uber";
  if (filter === "fedex") {
    return sign?.kind === "delivery" || sign?.kind === "label_ready";
  }
  // awaiting: portal was sent but client hasn't responded yet
  if (filter === "awaiting") {
    return !!sign && (sign.kind === "awaiting" || sign.kind === "payment_pending");
  }
  return true;
}

export type ReadyToShipShippingFilterMap = Record<
  string,
  ReadyToShipShippingFilter
>;

function rtsShippingStorageKey(tenantId: string): string {
  return `board-rts-shipping-filter-${tenantId}`;
}

export function loadReadyToShipShippingFilterMap(
  tenantId: string
): ReadyToShipShippingFilterMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(rtsShippingStorageKey(tenantId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: ReadyToShipShippingFilterMap = {};
    for (const [id, mode] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      if (isReadyToShipShippingFilter(mode) && mode !== "all") out[id] = mode;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveReadyToShipShippingFilterMap(
  tenantId: string,
  map: ReadyToShipShippingFilterMap
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(rtsShippingStorageKey(tenantId), JSON.stringify(map));
  } catch {
    /* ignore quota / private mode */
  }
}

export function getReadyToShipShippingFilter(
  map: ReadyToShipShippingFilterMap,
  columnId: string
): ReadyToShipShippingFilter {
  return map[columnId] ?? "all";
}
