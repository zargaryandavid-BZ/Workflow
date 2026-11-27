/**
 * Pixel Press Print customer emails (Hayk 2026-11-27: "dedicate that number fully
 * to pixel press… fully separated"). Orders from pixelpressprint.com carry
 * specs.brand = "PIXELPRESS" (website webhook). Their customer emails must come
 * from info@pixelpressprint.com, signed Pixel Press Print — never Bazaar.
 *
 * Sender: the Google service account must have domain-wide delegation (gmail.send)
 * in the pixelpressprint.com Workspace. Until it does, gmail-send falls back to the
 * Bazaar sender so no customer email is ever dropped (body is still Pixel Press).
 */

export type EmailBrand = "BAZAAR" | "PIXELPRESS";

export const PIXELPRESS_NAME = "Pixel Press Print";

export function pixelPressFromEmail(): string {
  return (process.env.PIXELPRESS_GMAIL_FROM_EMAIL?.trim() || "info@pixelpressprint.com").toLowerCase();
}

export function pixelPressReplyTo(): string {
  return (process.env.PIXELPRESS_REPLY_TO_EMAIL?.trim() || pixelPressFromEmail()).toLowerCase();
}

function specsObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Brand of an order from its specs (website webhook stamps specs.brand). */
export function emailBrandFromSpecs(specs: unknown): EmailBrand {
  const b = specsObject(specs).brand;
  return typeof b === "string" && b.trim().toUpperCase() === "PIXELPRESS" ? "PIXELPRESS" : "BAZAAR";
}

/** Brand of an order by id (one small read). Any error → Bazaar (today's behavior). */
export async function emailBrandForOrder(orderId: string | null | undefined): Promise<EmailBrand> {
  if (!orderId) return "BAZAAR";
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { data } = await createAdminClient()
      .from("orders")
      .select("specs")
      .eq("id", orderId)
      .maybeSingle();
    return emailBrandFromSpecs((data as { specs?: unknown } | null)?.specs);
  } catch {
    return "BAZAAR";
  }
}

/** Shop name used in "{{brand}}" / "<name> Team" for this brand. */
export function brandTenantName(brand: EmailBrand | undefined, tenantName: string): string {
  return brand === "PIXELPRESS" ? PIXELPRESS_NAME : tenantName;
}

// Exact Bazaar strings that appear in Workflow email templates/signatures.
const PIXELPRESS_REPLACEMENTS: Array<[RegExp, string]> = [
  [/https:\/\/bazaarprinting\.com\/assets\/Bazaar\.png/g, "https://pixelpressprint.com/assets/images/logos/pixelpress-horizontal.png"],
  [/info@bazaarprinting\.com/gi, "info@pixelpressprint.com"],
  [/www\.bazaarprinting\.com/gi, "www.pixelpressprint.com"],
  [/\(\+1\) 747 348 4444/g, "(+1) 213 770 4777"],
  [/\(747\) 348-4444/g, "(213) 770-4777"],
  [/747-348-4444/g, "213-770-4777"],
  [/306 Boyd St,? Los Angeles,? CA 90013/gi, "1025 E 16th St, Los Angeles, CA 90021"],
  [/BazaarPrinting Team/g, `${PIXELPRESS_NAME} Team`],
  [/Bazaar Printing/g, PIXELPRESS_NAME],
];

/** Rewrites Bazaar names/contact details to Pixel Press. Links/tokens untouched. */
export function rebrandText(text: string, brand: EmailBrand | undefined): string;
export function rebrandText(text: string | undefined, brand: EmailBrand | undefined): string | undefined;
export function rebrandText(text: string | undefined, brand: EmailBrand | undefined): string | undefined {
  if (brand !== "PIXELPRESS" || !text) return text;
  let out = text;
  for (const [re, to] of PIXELPRESS_REPLACEMENTS) out = out.replace(re, to);
  return out;
}
