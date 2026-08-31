import type { NotificationRuleRecipient } from "./types.ts";

/**
 * Missing Info (exception) columns use the staff popup as the send gate.
 * Auto `on_enter_column` customer email/SMS must not fire on drop, or Cancel
 * in the popup looks like “not sent” while the client already got a message.
 */
export function isMissingInfoNotifyHoldColumn(opts: {
  kind?: string | null;
  name?: string | null;
}): boolean {
  if (opts.kind === "exception") return true;
  return /missing\s*info/i.test(opts.name ?? "");
}

function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function samePhone(a: string, b: string | null | undefined): boolean {
  if (!b?.trim()) return false;
  const left = phoneDigits(a);
  const right = phoneDigits(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const stripUs = (d: string) =>
    d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return stripUs(left) === stripUs(right);
}

/**
 * Drop customer addresses from a notification-rule recipient list when the
 * Missing Info popup is responsible for contacting the client. Staff still
 * receive `both` / `staff` rules.
 */
export function recipientsAfterMissingInfoHold(opts: {
  holdCustomer: boolean;
  recipient: NotificationRuleRecipient;
  emails: string[];
  phones: string[];
  customerEmail: string | null | undefined;
  customerPhone: string | null | undefined;
}): { emails: string[]; phones: string[] } {
  if (!opts.holdCustomer || opts.recipient === "staff") {
    return { emails: opts.emails, phones: opts.phones };
  }
  if (opts.recipient === "customer") {
    return { emails: [], phones: [] };
  }
  const custEmail = opts.customerEmail?.trim().toLowerCase() ?? "";
  return {
    emails: custEmail
      ? opts.emails.filter((e) => e.trim().toLowerCase() !== custEmail)
      : opts.emails,
    phones: opts.phones.filter((p) => !samePhone(p, opts.customerPhone)),
  };
}
