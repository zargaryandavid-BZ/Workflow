/** Ready to Ship column: filter cards by shipping choice. */

export type ReadyToShipShippingFilter =
  | "all"
  | "pickup"
  | "fedex"
  | "self_fedex"
  | "awaiting";

export const READY_TO_SHIP_SHIPPING_OPTIONS: {
  value: ReadyToShipShippingFilter;
  label: string;
}[] = [
  { value: "all", label: "All" },
  { value: "pickup", label: "Pickup" },
  { value: "fedex", label: "FedEx" },
  { value: "self_fedex", label: "Self FedEx" },
  { value: "awaiting", label: "Awaiting" },
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
  if (filter === "pickup") return sign?.kind === "pickup";
  if (filter === "self_fedex") return sign?.kind === "client_fedex";
  if (filter === "fedex") {
    return sign?.kind === "delivery" || sign?.kind === "label_ready";
  }
  return !sign || sign.kind === "awaiting" || sign.kind === "payment_pending";
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
