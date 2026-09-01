/**
 * File preview on the customer page uses this, not calendar expiry.
 * Date-expired tokens still block *submitting* a response. Status `expired`
 * means a newer approval round replaced this link.
 */
export function notificationBlocksCustomerAssets(
  status: string | null | undefined
): boolean {
  return status === "expired";
}
