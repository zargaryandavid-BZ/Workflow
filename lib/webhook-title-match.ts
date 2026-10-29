/**
 * Whether a card found only by its short title belongs to this webhook order.
 * A stored order number / CRM id must match; cards with neither (legacy or
 * hand-made) only count when recent.
 */
export function titleMatchIsSameOrder(
  specs: Record<string, unknown>,
  createdAt: string | null,
  webhookOrderNumber: string,
  crmOrderId: string,
  maxAgeMs: number,
  now: number = Date.now()
): boolean {
  const storedNumber =
    typeof specs.webhook_order_number === "string"
      ? specs.webhook_order_number.trim()
      : "";
  const storedCrmId =
    typeof specs.crm_order_id === "string" ? specs.crm_order_id.trim() : "";
  if (storedNumber || storedCrmId) {
    return (
      (storedNumber !== "" && storedNumber === webhookOrderNumber.trim()) ||
      (storedCrmId !== "" && crmOrderId !== "" && storedCrmId === crmOrderId)
    );
  }
  const created = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isFinite(created) && now - created <= maxAgeMs;
}
