import type { PreferredChannel } from "./types.ts";

export type ResolvedSendChannel = "email" | "sms" | "both" | "manual";

export function normalizePreferredChannel(
  value: string | null | undefined
): PreferredChannel {
  if (value === "email") return "email";
  if (value === "both") return "both";
  return "sms";
}

export function isPreferredChannel(value: unknown): value is PreferredChannel {
  return value === "sms" || value === "email" || value === "both";
}

/** Plain label staff see: "Email", "SMS", "Email + SMS". */
export function preferredChannelLabel(
  value: PreferredChannel | string | null | undefined
): string {
  const v = normalizePreferredChannel(value);
  if (v === "both") return "Email + SMS";
  if (v === "email") return "Email";
  return "SMS";
}

/**
 * Pick the channel(s) for a customer notification.
 * Honors the customer's preferred_channel (default SMS), then falls back to
 * whichever contact method is available.
 */
export function resolvePreferredNotifyChannel(
  contact: { email: string | null; phone: string | null },
  preferred: PreferredChannel | string | null | undefined,
  smsConfigured: boolean
): ResolvedSendChannel {
  const want = normalizePreferredChannel(preferred);
  const canSms = Boolean(contact.phone?.trim()) && smsConfigured;
  const canEmail = Boolean(contact.email?.trim());

  if (want === "both") {
    if (canEmail && canSms) return "both";
    if (canEmail) return "email";
    if (canSms) return "sms";
    return "manual";
  }

  if (want === "sms") {
    if (canSms) return "sms";
    if (canEmail) return "email";
    return "manual";
  }

  if (canEmail) return "email";
  if (canSms) return "sms";
  return "manual";
}

/** For pickers that only offer a single email/sms choice (no manual). */
export function defaultSendChannel(
  contact: { email: string | null; phone: string | null },
  preferred: PreferredChannel | string | null | undefined,
  smsConfigured = true
): "email" | "sms" {
  const resolved = resolvePreferredNotifyChannel(
    contact,
    preferred,
    smsConfigured
  );
  if (resolved === "sms") return "sms";
  return "email";
}

/**
 * Default Email/SMS chips on every customer send panel.
 * Uses the customer's saved default (the Customers page in the left menu, or
 * "Save as default" on the card / send panel). There is no tenant-wide
 * default setting: a customer who never chose gets SMS (the DB default).
 * Falls back to the other method if the preferred one has no contact details.
 */
export function defaultSendChannels(
  contact: { email: string | null; phone: string | null },
  preferred: PreferredChannel | string | null | undefined,
  smsConfigured = true
): Array<"email" | "sms"> {
  const resolved = resolvePreferredNotifyChannel(
    contact,
    preferred,
    smsConfigured
  );
  if (resolved === "both") return ["email", "sms"];
  if (resolved === "email" || resolved === "sms") return [resolved];
  // No usable contact yet — still pre-select what the customer asked for so
  // staff see the preference while they type the address in.
  const want = normalizePreferredChannel(preferred);
  return want === "both" ? ["email", "sms"] : [want];
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

export function toggleSendChannelSelection(
  prev: ReadonlyArray<"email" | "sms">,
  next: "email" | "sms"
): Array<"email" | "sms"> {
  if (prev.includes(next)) {
    const nextSel = prev.filter((c) => c !== next);
    return nextSel.length === 0 ? [...prev] : nextSel;
  }
  return [...prev, next];
}

/** The preference a send-panel selection would save as the customer default. */
export function preferredChannelFromSelection(
  selected: ReadonlyArray<"email" | "sms">
): PreferredChannel | null {
  return channelFromSelection(selected);
}

/**
 * Did staff ever choose this preference on purpose? Every customer row has
 * preferred_channel = 'sms' by DB default, so 'sms' alone means "never chosen"
 * unless preferred_channel_set_at is stamped. Email/Both are always deliberate.
 */
export function isExplicitPreferredChannel(
  customer:
    | {
        preferred_channel?: string | null;
        preferred_channel_set_at?: string | null;
      }
    | null
    | undefined
): boolean {
  if (!customer) return false;
  if (customer.preferred_channel_set_at) return true;
  const v = normalizePreferredChannel(customer.preferred_channel);
  return v === "email" || v === "both";
}

/**
 * Which channels an automatic (no-popup) customer message should use.
 * Automatic shipped / picked-up / stage messages historically went to every
 * contact on file — keep that when the customer never chose a default, and
 * honor the saved default once they have one (falling back to the other
 * channel if the preferred contact is missing, so the customer still hears).
 */
export function automaticNotifyChannels(args: {
  email: string | null | undefined;
  phone: string | null | undefined;
  preferred: PreferredChannel | string | null | undefined;
  explicit: boolean;
}): { email: boolean; sms: boolean } {
  const hasEmail = Boolean(args.email?.trim());
  const hasPhone = Boolean(args.phone?.trim());
  if (!args.explicit) return { email: hasEmail, sms: hasPhone };
  const want = normalizePreferredChannel(args.preferred);
  if (want === "both") return { email: hasEmail, sms: hasPhone };
  if (want === "email") {
    return hasEmail
      ? { email: true, sms: false }
      : { email: false, sms: hasPhone };
  }
  return hasPhone
    ? { email: false, sms: true }
    : { email: hasEmail, sms: false };
}

export function destinationForChannel(
  contact: { email: string | null; phone: string | null },
  channel: "email" | "sms"
): string {
  return channel === "sms"
    ? (contact.phone ?? "").trim()
    : (contact.email ?? "").trim();
}

/**
 * Channel for re-sending an existing request (batch re-request of stale
 * approvals / missing info). It used to always reuse the channel of the last
 * send, so a customer later saved as "Email" kept getting SMS. Once the
 * customer has an explicit default, use it (falling back to the other method
 * when the preferred contact is missing); otherwise keep the previous channel.
 */
export function rerequestChannel(args: {
  previous: string | null | undefined;
  email: string | null | undefined;
  phone: string | null | undefined;
  preferred: PreferredChannel | string | null | undefined;
  explicit: boolean;
  smsConfigured?: boolean;
}): "email" | "sms" | "both" {
  const prev: "email" | "sms" | "both" =
    args.previous === "sms" || args.previous === "both"
      ? args.previous
      : "email";
  if (!args.explicit) return prev;
  const resolved = resolvePreferredNotifyChannel(
    { email: args.email ?? null, phone: args.phone ?? null },
    args.preferred,
    args.smsConfigured ?? true
  );
  return resolved === "manual" ? prev : resolved;
}

/**
 * Plain note for a send panel when the customer's saved default cannot be
 * used because that contact is missing on the customer record the card is
 * linked to (e.g. saved as Email but this record has no email address).
 */
export function preferredChannelFallbackNote(
  contact: { email: string | null | undefined; phone: string | null | undefined },
  preferred: PreferredChannel | string | null | undefined
): string | null {
  const want = normalizePreferredChannel(preferred);
  const hasEmail = Boolean(contact.email?.trim());
  const hasPhone = Boolean(contact.phone?.trim());
  if (want === "email" && !hasEmail && hasPhone) {
    return "Saved default is Email, but this customer record has no email address, so SMS is selected.";
  }
  if (want === "sms" && !hasPhone && hasEmail) {
    return "Saved default is SMS, but this customer record has no phone number, so Email is selected.";
  }
  if (want === "both" && hasEmail !== hasPhone) {
    return hasEmail
      ? "Saved default is Email + SMS, but this customer record has no phone number."
      : "Saved default is Email + SMS, but this customer record has no email address.";
  }
  return null;
}
