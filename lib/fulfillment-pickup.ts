import { normalizePickupCode } from "./pickup-code.ts";

export type PickupConfirmationInput = {
  orderId: string;
  firstName: string;
  lastName: string;
  signatureDataUrl: string;
  /** 8-digit code from the "Ready for pickup" message. */
  pickupCode?: string;
  /** Staff saw "already picked up" and chose to sign again. */
  confirmAgain?: boolean;
  /** Staff chose to release without the code (customer doesn't have it). */
  skipCode?: boolean;
  /** Who skipped the code — typed on the pickup screen (required to skip). */
  skippedBy?: string;
  /** Logged-in user who skipped, when the pickup screen is signed in. */
  skippedByUserId?: string | null;
};

/** Saved on each order as `specs.pickup_confirmation`. */
export type PickupConfirmation = {
  first_name: string;
  last_name: string;
  picked_up_at: string;
  signature_path: string;
  /** The code that was checked (kept so it is never handed out again). */
  code?: string | null;
  /** Small PDF with name, date and signature, listed in the order's files. */
  receipt_path?: string | null;
  receipt_asset_id?: string | null;
  /** Every order part this one signature covered. */
  order_ids?: string[];
  /** Staff released the order without checking the code. */
  code_skipped?: boolean;
  code_skipped_by?: string | null;
  code_skipped_by_user_id?: string | null;
};

export type PickupCodeCheck = "ok" | "not_required" | "missing" | "wrong";

/** Compare the typed code with the one sent to the customer. */
export function checkPickupCode(
  expected: string | null,
  typed: unknown
): PickupCodeCheck {
  if (!expected) return "not_required";
  const given = normalizePickupCode(typed);
  if (!given) return "missing";
  return given === expected ? "ok" : "wrong";
}

export type PickupCodeGate = PickupCodeCheck | "skipped" | "skip_needs_name";

/**
 * Code check with the staff "skip" option: a skip only counts when the staff
 * member typed their name, so every skip is on record. Skipping an order that
 * has no code is just "not_required".
 */
export function pickupCodeGate(
  expected: string | null,
  typed: unknown,
  skip?: { skip?: boolean; by?: string | null }
): PickupCodeGate {
  if (!expected) return "not_required";
  if (skip?.skip) {
    return skip.by?.trim() ? "skipped" : "skip_needs_name";
  }
  return checkPickupCode(expected, typed);
}

export function pickupConfirmationFromSpecs(
  specs: Record<string, unknown> | null | undefined
): PickupConfirmation | null {
  const raw = specs?.pickup_confirmation;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const c = raw as Partial<PickupConfirmation>;
  if (typeof c.first_name !== "string" || typeof c.picked_up_at !== "string") {
    return null;
  }
  return c as PickupConfirmation;
}

const MAX_SIGNATURE_BYTES = 750_000;

export function formatPickupDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

export function pickupRecipientName(firstName: string, lastName: string): string {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
}

export function decodePickupSignaturePng(dataUrl: string): Buffer | null {
  const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const bytes = Buffer.from(match[1]!, "base64");
  if (bytes.length === 0 || bytes.length > MAX_SIGNATURE_BYTES) return null;
  const pngMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < pngMagic.length || !bytes.subarray(0, 8).equals(pngMagic)) {
    return null;
  }
  return bytes;
}
