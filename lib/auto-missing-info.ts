/**
 * Automatic Missing Info for new orders that arrive with no print files
 * (Hayk 2026-11-26: turned back ON, now with an automatic customer request).
 *
 * Flow:
 *  1. Ingest (lib/webhook-order.ts): a brand-new card whose sender said "no
 *     files" (needs_customer_files / design_source files_coming) and that came
 *     with no artwork lands in Missing Info and is stamped
 *     `specs.auto_missing_info = { at, reason: "no_files" }`. No message yet.
 *  2. The 5-minute Missing Info Drive sweep (lib/missing-info-drive-sweep.ts)
 *     waits a grace period (the website drops checkout artwork into the Drive
 *     folder right AFTER the order arrives), then — if the card is still in
 *     Missing Info, its Drive folders are still empty and nobody has asked the
 *     customer yet — sends the same missing_info request staff send.
 *  3. Files arriving later in Drive send the card back via the pending link
 *     (same sweep), exactly like the customer using the link.
 *
 * Dependency-free so it can be unit-tested in isolation.
 */

import type { ResolvedSendChannel } from "./preferred-channel.ts";
import { resolvePreferredNotifyChannel } from "./preferred-channel.ts";

/** specs key stamped on a card that landed in Missing Info automatically. */
export const AUTO_MISSING_INFO_SPEC_KEY = "auto_missing_info";

/** Activity action recording the automatic request outcome (one per card). */
export const AUTO_MISSING_INFO_ACTIVITY = "auto_missing_info_notify";

/** Wait this long after the card is created before asking the customer. */
export const AUTO_MISSING_INFO_GRACE_MS = 15 * 60 * 1000;

/** Never auto-ask on cards older than this (stale marker / old cards). */
export const AUTO_MISSING_INFO_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * The "what we need" note: shown on the card / partner portal ("We need: …")
 * and in the email as "Note from our team". Same wording the ingest hold
 * reason already uses, so the portal text does not change.
 */
export const AUTO_MISSING_INFO_NOTE =
  "Print-ready artwork files — none were uploaded with this order. Please upload your files.";

export type AutoMissingInfoMarker = {
  at: string;
  reason: "no_files";
};

/** design_source value for "we design it" orders — never ask for files. */
function isDesignOrder(designSource: string | null | undefined): boolean {
  const v = (designSource ?? "").trim().toLowerCase();
  return v === "needs_design" || v === "design" || v === "we_design";
}

/**
 * May a NEW card be placed in Missing Info automatically? Never when files
 * came with the order, never for reorders (approved files are reused), never
 * for design orders (our designer makes the files).
 */
export function autoMissingInfoAllowed(opts: {
  enabled: boolean;
  incomingHasArtwork: boolean;
  isReorder: boolean;
  designSource: string | null | undefined;
}): boolean {
  if (!opts.enabled) return false;
  if (opts.incomingHasArtwork) return false;
  if (opts.isReorder) return false;
  if (isDesignOrder(opts.designSource)) return false;
  return true;
}

/** Did the sender tell us the files are missing (vs. "other details")? */
export function orderArrivedWithoutFiles(opts: {
  needsCustomerFiles: boolean;
  designSource: string | null | undefined;
  incomingHasArtwork: boolean;
}): boolean {
  if (opts.incomingHasArtwork) return false;
  if (opts.needsCustomerFiles) return true;
  return (opts.designSource ?? "").trim().toLowerCase() === "files_coming";
}

export function buildAutoMissingInfoMarker(now: Date = new Date()): AutoMissingInfoMarker {
  return { at: now.toISOString(), reason: "no_files" };
}

/** Read the marker off a card's specs (null when absent / malformed). */
export function readAutoMissingInfoMarker(
  specs: Record<string, unknown> | null | undefined
): AutoMissingInfoMarker | null {
  const raw = specs?.[AUTO_MISSING_INFO_SPEC_KEY];
  if (!raw || typeof raw !== "object") return null;
  const at = (raw as { at?: unknown }).at;
  if (typeof at !== "string" || !Number.isFinite(new Date(at).getTime())) {
    return null;
  }
  return { at, reason: "no_files" };
}

export type AutoNotifyTiming = "wait" | "due" | "too_old";

/** Is it time to ask the customer for this card? */
export function autoMissingInfoTiming(
  markerAt: string,
  nowMs: number,
  graceMs: number = AUTO_MISSING_INFO_GRACE_MS,
  maxAgeMs: number = AUTO_MISSING_INFO_MAX_AGE_MS
): AutoNotifyTiming {
  const t = new Date(markerAt).getTime();
  if (!Number.isFinite(t)) return "too_old";
  const age = nowMs - t;
  if (age < graceMs) return "wait";
  if (age > maxAgeMs) return "too_old";
  return "due";
}

/**
 * Channel for the automatic request. A saved customer default ("Always send
 * to this customer by …") wins, falling back to the other method when that
 * contact is missing. No saved default → email (SMS only when there is no
 * email). null = no way to reach the customer.
 */
export function autoMissingInfoChannel(opts: {
  email: string | null | undefined;
  phone: string | null | undefined;
  preferred: string | null | undefined;
  explicit: boolean;
  smsConfigured: boolean;
}): "email" | "sms" | "both" | null {
  const contact = { email: opts.email ?? null, phone: opts.phone ?? null };
  const resolved: ResolvedSendChannel = resolvePreferredNotifyChannel(
    contact,
    opts.explicit ? opts.preferred : "email",
    opts.smsConfigured
  );
  return resolved === "manual" ? null : resolved;
}

/** Any real file (not a folder) in the card's Drive folders? */
export function driveListingHasFiles(
  files: ReadonlyArray<{ mimeType?: string | null }>
): boolean {
  return files.some(
    (f) => (f.mimeType ?? "") !== "application/vnd.google-apps.folder"
  );
}
