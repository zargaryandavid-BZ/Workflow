import type { PreferredChannel } from "@/lib/types";

export type ResolvedSendChannel = "email" | "sms" | "manual";

export function normalizePreferredChannel(
  value: string | null | undefined
): PreferredChannel {
  return value === "email" ? "email" : "sms";
}

/**
 * Pick email vs SMS for customer notifications.
 * Honors the customer's preferred_channel (default SMS), then falls back to
 * whichever contact method is available.
 */
export function resolvePreferredNotifyChannel(
  contact: { email: string | null; phone: string | null },
  preferred: PreferredChannel | null | undefined,
  smsConfigured: boolean
): ResolvedSendChannel {
  const want = normalizePreferredChannel(preferred);
  const canSms = Boolean(contact.phone?.trim()) && smsConfigured;
  const canEmail = Boolean(contact.email?.trim());

  if (want === "sms") {
    if (canSms) return "sms";
    if (canEmail) return "email";
    return "manual";
  }

  if (canEmail) return "email";
  if (canSms) return "sms";
  return "manual";
}

/** For pickers that only offer email/sms (no manual). */
export function defaultSendChannel(
  contact: { email: string | null; phone: string | null },
  preferred: PreferredChannel | null | undefined,
  smsConfigured = true
): "email" | "sms" {
  const resolved = resolvePreferredNotifyChannel(
    contact,
    preferred,
    smsConfigured
  );
  return resolved === "sms" ? "sms" : "email";
}

export function destinationForChannel(
  contact: { email: string | null; phone: string | null },
  channel: "email" | "sms"
): string {
  return channel === "sms"
    ? (contact.phone ?? "").trim()
    : (contact.email ?? "").trim();
}
