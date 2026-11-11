/**
 * Company notify contacts kept in the CRM (Hayk 2026-11-11, item 17): extra
 * Proof-approval emails, Shipping-notice emails, billing emails, and the rep's
 * email when "Copy rep on approvals" is on. Workflow only READS them.
 *
 * Endpoint: same CRM origin + secret as the net-terms ping
 * (CRM_FULFILL_WEBHOOK_URL / CRM_FULFILL_SECRET); override the URL with
 * CRM_NOTIFY_CONTACTS_URL. Any failure → null, so a send never breaks.
 */
export type CrmNotifyContacts = {
  approval_emails: string[];
  shipping_emails: string[];
  billing_emails: string[];
  cc_rep_on_approvals: boolean;
  rep_email: string | null;
};

export function crmNotifyContactsUrl(): string | null {
  const explicit = process.env.CRM_NOTIFY_CONTACTS_URL?.trim();
  if (explicit) return explicit;
  const fulfill = process.env.CRM_FULFILL_WEBHOOK_URL?.trim();
  if (!fulfill) return null;
  try {
    return new URL("/api/webhook/notify-contacts", fulfill).toString();
  } catch {
    return null;
  }
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function cleanList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const e = String(v ?? "").trim().toLowerCase();
    if (EMAIL_RE.test(e) && !out.includes(e)) out.push(e);
  }
  return out.slice(0, 10);
}

export function parseCrmNotifyContacts(json: unknown): CrmNotifyContacts | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  if (j.found !== true) return null;
  const rep = typeof j.rep_email === "string" && EMAIL_RE.test(j.rep_email.trim().toLowerCase())
    ? j.rep_email.trim().toLowerCase()
    : null;
  return {
    approval_emails: cleanList(j.approval_emails),
    shipping_emails: cleanList(j.shipping_emails),
    billing_emails: cleanList(j.billing_emails),
    cc_rep_on_approvals: j.cc_rep_on_approvals === true,
    rep_email: rep,
  };
}

/** Extra recipients for a message type, never repeating the main address. */
export function extraNotifyRecipients(
  contacts: CrmNotifyContacts | null,
  kind: "approval" | "shipping",
  primaryEmail: string | null | undefined
): string[] {
  if (!contacts) return [];
  const primary = (primaryEmail ?? "").trim().toLowerCase();
  const list =
    kind === "approval"
      ? [
          ...contacts.approval_emails,
          ...(contacts.cc_rep_on_approvals && contacts.rep_email ? [contacts.rep_email] : []),
        ]
      : contacts.shipping_emails;
  const out: string[] = [];
  for (const e of list) {
    if (e && e !== primary && !out.includes(e)) out.push(e);
  }
  return out;
}

export async function fetchCrmNotifyContacts(args: {
  email?: string | null;
  phone?: string | null;
  company?: string | null;
}): Promise<CrmNotifyContacts | null> {
  const url = crmNotifyContactsUrl();
  const secret = process.env.CRM_FULFILL_SECRET?.trim();
  if (!url || !secret) return null;
  if (!args.email?.trim() && !args.phone?.trim() && !args.company?.trim()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-fulfill-secret": secret },
      body: JSON.stringify({
        email: args.email?.trim() || undefined,
        phone: args.phone?.trim() || undefined,
        company: args.company?.trim() || undefined,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return parseCrmNotifyContacts(await res.json());
  } catch (err) {
    console.warn("[crm-notify-contacts] lookup failed:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** "main, extra1, extra2" To line for a shipping-type email (main first). */
export async function shippingEmailTo(
  email: string,
  phone?: string | null
): Promise<string> {
  const main = email.trim();
  const contacts = await fetchCrmNotifyContacts({ email: main, phone });
  return [main, ...extraNotifyRecipients(contacts, "shipping", main)].join(", ");
}
