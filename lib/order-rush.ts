/** Default board tag applied when a webhook marks an order as rush. */
export const RUSH_ORDER_TAG_NAME = "Rush Order";

const RUSH_TRUE = new Set(["true", "yes", "y", "1", "rush", "urgent"]);

/**
 * Parse CRM rush flags: boolean, 1, or strings like "true" / "rush" / "yes".
 */
export function parseWebhookRushFlag(raw: unknown): boolean {
  if (raw === true || raw === 1) return true;
  if (typeof raw === "string") {
    return RUSH_TRUE.has(raw.trim().toLowerCase());
  }
  return false;
}

const RUSH_KEYS = ["rush", "is_rush", "rush_order", "rush_status"] as const;

/**
 * Presence-aware read: `undefined` if none of the rush keys were sent.
 */
export function webhookRushFromPayload(
  raw: Record<string, unknown> | null | undefined
): boolean | undefined {
  if (!raw) return undefined;
  for (const key of RUSH_KEYS) {
    const value = raw[key];
    if (value === undefined || value === null || value === "") continue;
    return parseWebhookRushFlag(value);
  }
  return undefined;
}

export function isRushOrder(order: {
  tag?: { name?: string | null } | null;
  specs?: unknown;
}): boolean {
  const specs =
    order.specs && typeof order.specs === "object"
      ? (order.specs as { rush?: unknown })
      : null;
  if (specs?.rush === true) return true;
  return /rush/i.test(order.tag?.name ?? "");
}
