import { isEmailAddress, mergeEmailLists } from "./email-list.ts";
import { normalizeSmsPhone, validateSmsRecipient } from "./sms-phone.ts";

export const PRIMARY_CONTACT_ID = "primary";

export interface CustomerContact {
  id: string;
  tenant_id: string;
  customer_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
  updated_at?: string;
}

export interface NotifyContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export interface NotifyDestinations {
  toEmail: string | null;
  toPhone: string | null;
  ccEmails: string[];
  extraSmsPhones: string[];
}

export function uniqueSmsPhones(
  phones: Array<string | null | undefined>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of phones) {
    const value = (raw ?? "").trim();
    if (!value) continue;
    if (validateSmsRecipient(value)) continue;
    const key = normalizeSmsPhone(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function parseExtraSmsPhones(
  raw: unknown
): { valid: string[]; invalid: string[] } {
  const list: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string" && item.trim()) list.push(item.trim());
    }
  } else if (typeof raw === "string" && raw.trim()) {
    list.push(raw.trim());
  }
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const phone of list) {
    const err = validateSmsRecipient(phone);
    if (err) {
      invalid.push(phone);
      continue;
    }
    const key = normalizeSmsPhone(phone);
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(phone);
  }
  return { valid, invalid };
}

export function normalizeContactInput(body: {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
}): { name: string; email: string | null; phone: string | null } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const emailRaw = typeof body.email === "string" ? body.email.trim() : "";
  const phoneRaw = typeof body.phone === "string" ? body.phone.trim() : "";
  const email = emailRaw ? emailRaw.toLowerCase() : null;
  const phone = phoneRaw || null;
  return { name, email, phone };
}

export function contactInputError(input: {
  name: string;
  email: string | null;
  phone: string | null;
}): string | null {
  if (!input.email && !input.phone) {
    return "Add an email or a phone number.";
  }
  if (input.email && !isEmailAddress(input.email)) {
    return `Not a valid email: ${input.email}`;
  }
  if (input.phone) {
    const smsError = validateSmsRecipient(input.phone);
    if (smsError) return smsError;
  }
  return null;
}

/** Primary + extra company members the user checked for this send. */
export function buildNotifyDestinations(
  contacts: NotifyContact[],
  selectedIds: Iterable<string>
): NotifyDestinations {
  const selected = new Set(selectedIds);
  const chosen = contacts.filter((c) => selected.has(c.id));
  const emails = mergeEmailLists(chosen.map((c) => c.email ?? ""));
  const phones = uniqueSmsPhones(chosen.map((c) => c.phone));
  return {
    toEmail: emails[0] ?? null,
    ccEmails: emails.slice(1),
    toPhone: phones[0] ?? null,
    extraSmsPhones: phones.slice(1),
  };
}

export function extraSmsPhonesExcludingPrimary(
  extraSmsPhones: string[],
  primaryPhone: string | null | undefined
): string[] {
  if (!primaryPhone?.trim()) return uniqueSmsPhones(extraSmsPhones);
  const primary = normalizeSmsPhone(primaryPhone);
  return uniqueSmsPhones(extraSmsPhones).filter(
    (p) => normalizeSmsPhone(p) !== primary
  );
}
