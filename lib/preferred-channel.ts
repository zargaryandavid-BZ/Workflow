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

/**
 * Default channel selection for send/resend pickers.
 * When both email and phone are available, select both so staff can send together.
 */
export function defaultSendChannels(
  contact: { email: string | null; phone: string | null },
  preferred: PreferredChannel | null | undefined,
  smsConfigured = true
): Array<"email" | "sms"> {
  const canEmail = Boolean(contact.email?.trim());
  const canSms = Boolean(contact.phone?.trim()) && smsConfigured;
  if (canEmail && canSms) return ["email", "sms"];
  if (canEmail) return ["email"];
  if (canSms) return ["sms"];
  const fallback = defaultSendChannel(contact, preferred, smsConfigured);
  return [fallback];
}

export function channelFromSelection(
  selected: ReadonlyArray<"email" | "sms">
): "email" | "sms" | "both" | null {
  const email = selected.includes("email");
  const sms = selected.includes("sms");
  if (email && sms) return "both";
  if (email) return "email";
  if (sms) return "sms";
  return null;
}

export function destinationForChannel(
  contact: { email: string | null; phone: string | null },
  channel: "email" | "sms"
): string {
  return channel === "sms"
    ? (contact.phone ?? "").trim()
    : (contact.email ?? "").trim();
}
