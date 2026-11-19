/** Public customer-portal + branded email chrome. */
export const PORTAL_PRODUCT_NAME = "Printing House Automation Software";

export const POWERED_BY_DOMAIN = "pulseprintautomation.com";
export const POWERED_BY_URL = "https://pulseprintautomation.com";

/** Plain-text "Powered by" line (emails / SMS-free text bodies). */
export const POWERED_BY_LINE = `Powered by ${POWERED_BY_DOMAIN} — Print Shop Automation Software.`;

export const PORTAL_FOOTER = `This link expires in 30 days · Powered by ${POWERED_BY_DOMAIN} — Print Shop Automation Software.`;

/**
 * Email HTML for a footer line: escapes `text`, then links the
 * pulseprintautomation.com mention (if any).
 */
export function footerHtmlWithPoweredByLink(
  text: string,
  escapeHtml: (value: string) => string
): string {
  const safe = escapeHtml(text);
  return safe.replace(
    POWERED_BY_DOMAIN,
    `<a href="${POWERED_BY_URL}" target="_blank" rel="noopener" style="color:#64748b;text-decoration:underline;">${POWERED_BY_DOMAIN}</a>`
  );
}
