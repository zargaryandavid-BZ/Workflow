/**
 * 8-digit pickup code sent with the "Ready for pickup" message and typed into
 * the Pickup window. One code per message: every part of a split order that
 * the message covers shares it. Codes never repeat (checked against every
 * order that has ever had one — see pickup-code.server.ts).
 *
 * Stored on the order as `specs.pickup_code` and kept after pickup, so a used
 * code is never handed out again.
 */
export const PICKUP_CODE_SPEC_KEY = "pickup_code";
export const PICKUP_CODE_LENGTH = 8;
/** Shown in the staff message preview; replaced with the real code on send. */
export const PICKUP_CODE_PREVIEW = "[code added on send]";

/** Digits only ("1234 5678" / "1234-5678" → "12345678"); null unless exactly 8 digits. */
export function normalizePickupCode(input: unknown): string | null {
  if (typeof input !== "string" && typeof input !== "number") return null;
  const digits = String(input).replace(/[\s-]/g, "");
  return /^\d{8}$/.test(digits) ? digits : null;
}

/** The code saved on an order, or null. */
export function pickupCodeFromSpecs(
  specs: Record<string, unknown> | null | undefined
): string | null {
  return normalizePickupCode(specs?.[PICKUP_CODE_SPEC_KEY]);
}

/** "12345678" → "1234 5678" (easier to read out loud). */
export function formatPickupCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}

/**
 * Make sure the customer message carries the code: swap the preview
 * placeholder, then append a line when a custom template / staff-edited
 * body left the code out.
 */
export function ensurePickupCodeInMessage(
  text: string,
  code: string | null,
  separator: "\n\n" | " " = "\n\n"
): string {
  if (!code) return text.split(PICKUP_CODE_PREVIEW).join("").trim();
  const shown = formatPickupCode(code);
  const swapped = text.split(PICKUP_CODE_PREVIEW).join(shown);
  if (swapped.includes(shown) || swapped.includes(code)) return swapped;
  return `${swapped.trimEnd()}${separator}Pickup code: ${shown}`;
}
