export const FULFILLMENT_RECEIVE_STATUSES = [
  "received",
  "counted",
  "missing",
] as const;

export type FulfillmentReceiveStatus =
  (typeof FULFILLMENT_RECEIVE_STATUSES)[number];

export const FULFILLMENT_RECEIVE_STATUS_LABEL: Record<
  FulfillmentReceiveStatus,
  string
> = {
  received: "Order received",
  counted: "Order counted and approved",
  missing: "Missing/wrong info",
};

export function isFulfillmentReceiveStatus(
  value: unknown
): value is FulfillmentReceiveStatus {
  return (
    value === "received" || value === "counted" || value === "missing"
  );
}

/** Qty match → counted; mismatch → missing/wrong; otherwise just received. */
export function defaultReceiveStatus(
  expected: number,
  received: number
): FulfillmentReceiveStatus {
  if (!Number.isFinite(received) || !Number.isFinite(expected)) {
    return "received";
  }
  if (received === expected) return "counted";
  return "missing";
}

/** Worst line outcome wins: missing > received > counted. */
export function boxReceiveStatusFromLines(
  statuses: Array<FulfillmentReceiveStatus | null | undefined>
): FulfillmentReceiveStatus {
  if (statuses.some((s) => s === "missing")) return "missing";
  if (statuses.some((s) => s === "received")) return "received";
  if (statuses.some((s) => s === "counted")) return "counted";
  return "received";
}

/** Box status from expected vs received qty on every line. */
export function defaultBoxReceiveStatus(
  lines: Array<{ expected: number; received: number }>
): FulfillmentReceiveStatus {
  if (lines.length === 0) return "received";
  return boxReceiveStatusFromLines(
    lines.map((line) => defaultReceiveStatus(line.expected, line.received))
  );
}

export type FulfillmentReceiveColumns = {
  receive_column_id: string | null;
  counted_column_id: string | null;
  missing_column_id: string | null;
};

export function columnIdForReceiveStatus(
  status: FulfillmentReceiveStatus,
  settings: FulfillmentReceiveColumns
): string | null {
  if (status === "counted") {
    return settings.counted_column_id || settings.receive_column_id;
  }
  if (status === "missing") {
    return settings.missing_column_id || settings.receive_column_id;
  }
  return settings.receive_column_id;
}
