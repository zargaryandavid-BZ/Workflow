/** Payload `source` values that mean a website / storefront checkout. */
const WEBSITE_SOURCE_KEYS = new Set([
  "website",
  "web",
  "webform",
  "web-form",
  "web_form",
  "web store",
  "webstore",
  "storefront",
  "online",
  "shopify",
]);

export function isWebsiteWebhookSource(
  source: string | null | undefined
): boolean {
  const key = (source ?? "").trim().toLowerCase();
  return key !== "" && WEBSITE_SOURCE_KEYS.has(key);
}

/**
 * Board / card number for website checkouts: W + short digits (`W15082`, `W15082-1`).
 * Does not double-prefix if the short number already starts with W.
 */
export function withWebOrderLetter(shortNumber: string): string {
  const s = shortNumber.trim();
  if (!s) return s;
  const rest = s.replace(/^w-?/i, "");
  return `W${rest}`;
}
