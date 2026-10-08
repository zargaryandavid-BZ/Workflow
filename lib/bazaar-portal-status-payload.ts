/**
 * Pure builder for the status callback Bazaar expects at
 * POST {bazaar_api_url}/api/v1/production/status.
 *
 * Verified Bazaar contract body:
 *   { order_number, column_name, moved_at }   (moved_at = ISO move time)
 *
 * `event` is kept for parity with the disconnect/test-connection calls that
 * already POST this endpoint; Bazaar ignores unknown fields.
 *
 * Kept dependency-free so it can be unit-tested under the node test runner.
 */

export type BazaarPortalStatusPayload = {
  event: "job_status_update";
  order_number: string;
  column_name: string;
  moved_at: string;
};

export function buildBazaarPortalStatusPayload(args: {
  orderNumber: string;
  columnName: string;
  movedAt?: string;
}): BazaarPortalStatusPayload {
  return {
    event: "job_status_update",
    order_number: args.orderNumber,
    column_name: args.columnName,
    moved_at: args.movedAt ?? new Date().toISOString(),
  };
}
